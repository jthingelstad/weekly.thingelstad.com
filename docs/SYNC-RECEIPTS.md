# The optional arrival receipt

The deploy snapshots the public feed before publishing. After CloudFront's
checks pass, it reads the feed back and reports a new issue only when its
identity and date match the tested build and its number advanced from the
known earlier public issue. The editorial issue date may be in the future;
the receipt's time is the completed public verification, not that date.
Unknown baselines, failed reads, unchanged builds and rollbacks send nothing.

`scripts/sync-receipt.mjs` selects public id, URL and time only. The transport
uses the existing OIDC identity, checks every EventBridge entry, and emits
`weekly / received`, `via: site-deploy`. No secret or browser code is added.
An announcement failure warns after the healthy deployment; polling remains
the backstop. It is best effort, with no claim of durable delivery or a
synthetic arrival to prove the permission.

This PR is prepared only: no merge, infrastructure apply, deployment or bus
test is performed. Before activation, Jamie merges/applies the sync stack's
companion grant for the existing delivery role, scoped to
`thingelstad-publishing`, source `weekly`, types `received` and `ping`.
Then set the repository Actions variable `SYNC_RECEIVED_BUS` to
`thingelstad-publishing`. Empty is off. Let the next natural send exercise it;
a fixture is the rehearsal, never a test `published` or `received` event.

Hop 17 still needs a producer-defined topic identity before a topic arrival
can be reported. A destination cannot invent one. This sender reports the
issue it can verify and leaves that kind no-fact. Hop 6 is unchanged.
