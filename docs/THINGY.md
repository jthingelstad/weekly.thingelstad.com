# Thingy on this site

Thingy has two jobs on the Weekly Thing site, and neither is writing it. Who he
is, how he looks and how he sounds is his
[persona](https://thingy.thingelstad.xyz/persona.md), which Jamie approved on
2026-11-03. It is the authority on every surface, so read it whole before writing
anything in his voice. This file keeps only what is particular to this site. Where
the two differ the persona wins: change the character there first, then here. The
model, the stills and the faces are in the
[Thingy Kit](https://thingy.thingelstad.xyz/kit/).

## His jobs here

| Job | Where | Scene | Register |
| --- | --- | --- | --- |
| Host of Supporting Membership | The Membership box in an issue, and `/members/` | Concert | His most persuasive: enthusiastic, specific about where the money goes, a clear ask. Never a plea, guilt or pressure |
| Librarian | Echoes in an issue, and the doors to Ask Thingy: `/confirmed/`, topic pages, the 404 | Library | Curious and warm. Opens doors rather than closing topics |

He hosts the whole of `/members/` (Jamie, 2026-11-06: "let's have Thingy be the host
of the Members page. That makes sense because he does that in the newsletter too!").
The rest of the site's words are Jamie's to write. He gets no other job here unless
Jamie gives him one, and a new job goes into the persona first.

## Whose name is on what

Jamie's h-card stays the author of the site and of every issue, and the footer
says the newsletter is his. Thingy never writes as Jamie, and his words never pass
as Jamie's, so:

- **Jamie's pages carry no Thingy:** the front page and `/about/`, which speak as
  Jamie. `tests/e2e/site.spec.js` fails if his face or a host block appears on
  either.
- **Thingy's words carry his name and face:** the two boxes WT Builder prints in an
  issue, and all of `/members/`, which opens with his face and "I'm Thingy" and says
  "hosted by Thingy" above the headline. A face beside a link to him (`.thingy-head`)
  adds no words.
- **He says "I" only there.** Every other page names him and then says he/him.
- **On `/members/`, Jamie appears only in quotes.** A "why" is Jamie's own words,
  quoted exactly and linked, in `.thingy-quote`. Jamie's reason for this year's
  nonprofit is `current.why` in `_data/support.json`: replace it when the nonprofit
  changes, or leave it out. A unit test checks the quote against the issue it links.
- **Neutral facts stay neutral.** The labels and plain terms in `support.njk` (price,
  100%, one-time gifts, cancel anytime) speak as nobody, so they fit under his
  headings and stay in the corpus.

## His pictures

Stills come from `site.thingyStills` (`character/latest/poses/`), so a new model
reaches these pages with no change here. No JavaScript or 3D: this site loads his
pictures and none of his code, and it has no content security policy to change.

| Where | Still | Why |
| --- | --- | --- |
| `/members/`, opening the page | `concert-present` | The only Concert still. `eager` is his face for making the case, and would need a `concert-present-eager` still at his home |
| An issue's Membership label | `concert-present`, head cropped in CSS | The host |
| An issue's Echoes label, `/confirmed/`, topic pages | `library-hello-idle`, head cropped in CSS | The librarian, ready and listening |
| The 404 | `library-thinking-curious` | The face Ask Thingy's own 404 uses: a question he is turning over |

- **Dark mode:** his charcoal limbs and headphones sink into this site's dark
  ground, so he stands on `--thingy-ground`, the ivory Things I've Built uses.
- **If his home is down:** the labels, the words and `alt` stay, and only the
  picture goes.
- **Kept here on purpose:** `img/thingy.png` and `img/thingy-concert.png` are the
  audio edition's chapter art. WT Builder points at those addresses
  (`THINGY_IMAGE`, `THINGY_HOST_IMAGE` in `src/shared/render/audio.ts`) and a
  missing picture fails a send, so they stay published. `img/thingy-concert-avatar.png`
  and `img/thingy.png` are also the transcript's avatars.

His home's `kit/surfaces.json` lists what each site uses, so a new model cannot ship
without it. When this table changes, change that file too.

## His words stay out of the corpus

`librarian-thing` reads the source of `about.njk`, `support.njk` and
`_data/support.json` as its reference passages (`_site_page_chunks` in
`librarian_core/corpus.py`), dropping template tags and keeping everything else.
Thingy's words never enter the corpus, which is a hard rule there. So everything he
says on `/members/` lives in `partials/thingy-members.njk`, which the library does not
pull, and `support.njk` calls it with `{{ thingy.open() }}` and the like, which the
library drops. `support.njk` has to stay: the library fails without it, and its plain
facts are all Thingy's reference has on the price, one-time gifts and cancelling.
`tests/unit/thingy-corpus-fence.test.mjs` fails if his words or a first-person line
move into a file it reads, or if `support.njk` gains a `{# #}` comment, which the corpus
keeps as text.

`current.why` in `support.json` is Jamie's words, and the corpus does not read that
field. His first-person versions of the two benefit rows about himself are in the
partial too. `b.line` stays third person because WT Builder reads it.

## Facts have owners

The figures in his words are read at build time, never typed. Supporting
Membership's owner is `apps/site/_data/support.json`: the price, this year's
nonprofit, and what past years raised.

## What this repo does not own

His words in an issue, the frame around them and the email's version of it are WT
Builder's. A repair to a sent issue keeps them as they went out: WT350 to WT354
say "my agentic librarian", the label of their day.
