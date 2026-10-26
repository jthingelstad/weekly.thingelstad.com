// Publish the built site (_site/) to S3 behind CloudFront: the files that changed, the redirect map
// into the key value store, the pages the build no longer writes removed, then the cache cleared and
// the result read back through CloudFront.
//
// CI runs it as the delivery role after the browser tests pass (.github/workflows/deploy.yml); it also
// runs from this Mac as the cloud-engineer identity. Either way it refuses to publish when the site
// stack's live template differs from infra/generated/site.json: infrastructure changes go out first,
// on their own (`npm run infra -- site`).
//
//   node scripts/deploy-aws.mjs          upload what changed (by MD5) and remove what is gone
//   node scripts/deploy-aws.mjs --all    upload every file, after a change to publish-plan.mjs
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { CloudFrontClient, CreateInvalidationCommand, waitUntilInvalidationCompleted } from '@aws-sdk/client-cloudfront';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { publishPlan } from './publish-plan.mjs';

const ROOT = '_site';
const deployment = JSON.parse(readFileSync('infra/deployment.json', 'utf8'));
const region = deployment.region;
const all = process.argv.includes('--all');

const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
const allowed = [':assumed-role/ProjectsCloudEngineer/', ':assumed-role/weekly-delivery-DeploymentRole-'];
if (identity.Account !== deployment.account || !allowed.some((role) => identity.Arn.includes(role)))
  throw new Error(`Unexpected AWS identity ${identity.Arn}`);

const cloudformation = new CloudFormationClient({ region });
const stack = (await cloudformation.send(new DescribeStacksCommand({ StackName: deployment.stacks.site }))).Stacks[0];
if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(stack.StackStatus))
  throw new Error(`${deployment.stacks.site} is not ready: ${stack.StackStatus}`);
const live = (await cloudformation.send(new GetTemplateCommand({ StackName: deployment.stacks.site }))).TemplateBody;
if (!isDeepStrictEqual(JSON.parse(live), JSON.parse(readFileSync('infra/generated/site.json', 'utf8'))))
  throw new Error('The site stack differs from infra/generated/site.json. Deploy the infrastructure change first.');
const out = Object.fromEntries(stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]));
const bucket = out.SiteBucket;
const preview = `https://${out.CloudFrontDomain}`;

// A build missing its core files, or most of its pages, is not published.
const plan = publishPlan(ROOT);
const keys = new Set(plan.map((file) => file.key));
const required = ['index.html', '404.html', 'feed.xml', 'rss', 'sitemap.xml', 'archive/1/index.html', 'pagefind/pagefind.js'];
const absent = required.filter((key) => !keys.has(key));
if (absent.length || plan.length < 1000) throw new Error(`The build is incomplete: ${absent.join(', ') || `${plan.length} files`}`);
const redirects = JSON.parse(readFileSync(`${ROOT}/_redirects.json`, 'utf8'));
const bad = Object.entries(redirects).filter(([from, to]) => !/^\/.*\/$/.test(from) || !/^(\/|https:\/\/)/.test(to));
if (bad.length) throw new Error(`Malformed redirects: ${JSON.stringify(bad.slice(0, 3))}`);

// Upload what changed. A single-part upload's ETag is its MD5.
const s3 = new S3Client({ region, maxAttempts: 5 });
const existing = new Map();
let token;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
  for (const object of page.Contents ?? []) existing.set(object.Key, object.ETag?.replaceAll('"', ''));
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);
const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex');
const changed = plan.filter((file) => all || existing.get(file.key) !== md5(file.path));
// Files before pages and the front page last (publishPlan's order), a batch at a time.
for (let i = 0; i < changed.length; i += 16) {
  await Promise.all(
    changed.slice(i, i + 16).map((file) =>
      s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: file.key,
          Body: readFileSync(file.path),
          ContentType: file.contentType,
          CacheControl: file.cacheControl
        })
      )
    )
  );
}
console.log(`Uploaded ${changed.length} of ${plan.length} files.`);

// The redirect map. The key value store API signs with SigV4A, which the AWS CLI does natively, so it
// goes through the CLI; UpdateKeys takes 50 changes a call, each call naming the store's current ETag.
const cli = (...args) =>
  JSON.parse(execFileSync('aws', ['cloudfront-keyvaluestore', ...args, '--region', region, '--output', 'json'], { encoding: 'utf8' }));
const store = out.RedirectStoreArn;
let etag = cli('describe-key-value-store', '--kvs-arn', store).ETag;
const current = new Map();
let next;
do {
  const page = cli('list-keys', '--kvs-arn', store, ...(next ? ['--next-token', next] : []));
  for (const item of page.Items ?? []) current.set(item.Key, item.Value);
  next = page.NextToken;
} while (next);
const changes = [
  ...Object.entries(redirects)
    .filter(([from, to]) => current.get(from) !== to)
    .map(([Key, Value]) => ({ put: { Key, Value } })),
  ...[...current.keys()].filter((key) => !(key in redirects)).map((Key) => ({ delete: { Key } }))
];
for (let i = 0; i < changes.length; i += 50) {
  const batch = changes.slice(i, i + 50);
  const puts = batch.flatMap((c) => (c.put ? [c.put] : []));
  const deletes = batch.flatMap((c) => (c.delete ? [c.delete] : []));
  etag = cli(
    'update-keys', '--kvs-arn', store, '--if-match', etag,
    ...(puts.length ? ['--puts', JSON.stringify(puts)] : []),
    ...(deletes.length ? ['--deletes', JSON.stringify(deletes)] : [])
  ).ETag;
}
console.log(`Redirects: ${Object.keys(redirects).length}, ${changes.length} changed.`);

// Remove what the build no longer writes. The bucket keeps old versions for 90 days.
const stale = [...existing.keys()].filter((key) => !keys.has(key));
for (let i = 0; i < stale.length; i += 1000) {
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true }
    })
  );
}
console.log(`Removed ${stale.length} files the build no longer writes.`);

const cloudfront = new CloudFrontClient({ region: 'us-east-1' });
const invalidation = await cloudfront.send(
  new CreateInvalidationCommand({
    DistributionId: out.DistributionId,
    InvalidationBatch: {
      CallerReference: `${process.env.GITHUB_SHA ?? 'local'}-${Date.now()}`,
      Paths: { Quantity: 1, Items: ['/*'] }
    }
  })
);
await waitUntilInvalidationCompleted(
  { client: cloudfront, maxWaitTime: 900 },
  { DistributionId: out.DistributionId, Id: invalidation.Invalidation.Id }
);

// Read it back through the distribution: the front page as built, a feed with its type, a redirect, the
// slash form and a missing page. The key value store takes a few seconds to reach the edges.
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const [redirectFrom, redirectTo] = Object.entries(redirects).find(([from]) => from.startsWith('/archive/'));
const checks = [
  async () => {
    const r = await fetch(`${preview}/`);
    return r.ok && sha(Buffer.from(await r.arrayBuffer())) === sha(readFileSync(`${ROOT}/index.html`)) || 'front page differs from the build';
  },
  async () => {
    const r = await fetch(`${preview}/rss`);
    return (r.ok && r.headers.get('content-type')?.startsWith('application/xml')) || `/rss is ${r.status} ${r.headers.get('content-type')}`;
  },
  async () => {
    const r = await fetch(`${preview}${redirectFrom}?ref=check`, { redirect: 'manual' });
    return (r.status === 301 && r.headers.get('location') === `${redirectTo}?ref=check`) || `${redirectFrom} is ${r.status} ${r.headers.get('location')}`;
  },
  async () => {
    const r = await fetch(`${preview}/archive/1`, { redirect: 'manual' });
    return (r.status === 301 && r.headers.get('location') === '/archive/1/') || `/archive/1 is ${r.status}`;
  },
  async () => {
    const r = await fetch(`${preview}/archive/not-an-issue/`);
    return r.status === 404 || `a missing page is ${r.status}`;
  }
];
let failures = [];
for (let attempt = 0; attempt < 8; attempt++) {
  failures = (await Promise.all(checks.map((check) => check().catch((error) => error.message)))).filter((r) => r !== true);
  if (!failures.length) break;
  await delay(10_000);
}
if (failures.length) throw new Error(`Published site check failed: ${failures.join('; ')}`);
console.log(`Verified ${process.env.GITHUB_SHA ?? 'local build'} at ${preview}`);
