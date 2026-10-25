// The front page's hero line and the eyebrow above it. They live here, once,
// because two places read them: the hero itself (index.njk) and the
// newsletter's share card, which cards.thingelstad.com draws from the hero's
// h-feed and whose ?v= hashes them (layouts/base.njk), so new words get a new
// card. The title is HTML: its <br> break the card's lines too, and its <em>
// is the card's accent colour.

module.exports = {
  eyebrow: "Weekend reading since 2017",
  title: "A weekend letter<br>about <em>what I&rsquo;m</em><br><em>learning.</em>",
};
