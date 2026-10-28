"use strict";

// Complete texts are public-domain editions or texts supplied by the site owner.
const poems = {
  "change": {
    title: "Change",
    author: "Kathleen Raine",
    textOrigin: "user-provided",
    text: `Change
Said the sun to the moon,
You cannot stay.

Change
Says the moon to the waters,
All is flowing.

Change
Says the fields to the grass,
Seed-time and harvest,
Chaff and grain.

You must change said,
Said the worm to the bud,
Though not to a rose,

Petals fade
That wings may rise
Borne on the wind.

You are changing
said death to the maiden, your wan face
To memory, to beauty.

Are you ready to change?
Says the thought to the heart, to let her pass
All your life long

For the unknown, the unborn
In the alchemy
Of the world's dream?

You will change,
says the stars to the sun,
Says the night to the stars.`,
    source: "https://voetica.com/poem/16064",
    sourceName: "Voetica",
    edition: ""
  },
  "the-guest-house": {
    title: "The Guest House",
    author: "Rumi",
    translation: "English version by Coleman Barks",
    textOrigin: "user-provided",
    text: `This being human is a guest house.
Every morning a new arrival.

A joy, a depression, a meanness,
some momentary awareness comes
as an unexpected visitor.

Welcome and entertain them all!
Even if they’re a crowd of sorrows,
who violently sweep your house
empty of its furniture,
still, treat each guest honorably.
He may be clearing you out
for some new delight.

The dark thought, the shame, the malice,
meet them at the door laughing,
and invite them in.

Be grateful for whoever comes,
because each has been sent
as a guide from beyond.`,
    source: "https://www.scottishpoetrylibrary.org.uk/poem/guest-house/",
    sourceName: "Scottish Poetry Library",
    edition: "From Rumi: Selected Poems (Penguin, 2004), credited to Coleman Barks with John Moynce, A. J. Arberry, and Reynold Nicholson."
  },
  "ulysses": {
    title: "Ulysses",
    author: "Alfred, Lord Tennyson",
    text: `It little profits that an idle king,
By this still hearth, among these barren crags,
Matched with an aged wife, I mete and dole
Unequal laws unto a savage race,
That hoard, and sleep, and feed, and know not me.
I cannot rest from travel; I will drink
Life to the lees. All times I have enjoyed
Greatly, have suffered greatly, both with those
That loved me, and alone; on shore, and when
Through scudding drifts the rainy Hyades
Vext the dim sea. I am become a name;
For always roaming with a hungry heart
Much have I seen and known—cities of men
And manners, climates, councils, governments,
Myself not least, but honored of them all,—
And drunk delight of battle with my peers,
Far on the ringing plains of windy Troy.
I am a part of all that I have met;
Yet all experience is an arch wherethrough
Gleams that untraveled world whose margin fades
For ever and for ever when I move.
How dull it is to pause, to make an end,
To rust unburnished, not to shine in use!
As though to breathe were life! Life piled on life
Were all too little, and of one to me
Little remains; but every hour is saved
From that eternal silence, something more,
A bringer of new things; and vile it were
For some three suns to store and hoard myself,
And this gray spirit yearning in desire
To follow knowledge like a sinking star,
Beyond the utmost bound of human thought.

   This is my son, mine own Telemachus,
To whom I leave the scepter and the isle,
Well-loved of me, discerning to fulfill
This labor, by slow prudence to make mild
A rugged people, and through soft degrees
Subdue them to the useful and the good.
Most blameless is he, centered in the sphere
Of common duties, decent not to fail
In offices of tenderness, and pay
Meet adoration to my household gods,
When I am gone. He works his work, I mine.

   There lies the port; the vessel puffs her sail;
There gloom the dark, broad seas. My mariners,
Souls that have toiled, and wrought, and thought with me,
That ever with a frolic welcome took
The thunder and the sunshine, and opposed
Free hearts, free foreheads—you and I are old;
Old age hath yet his honor and his toil.
Death closes all; but something ere the end,
Some work of noble note, may yet be done,
Not unbecoming men that strove with gods.
The lights begin to twinkle from the rocks;
The long day wanes; the slow moon climbs; the deep
Moans round with many voices. Come, my friends,
'Tis not too late to seek a newer world.
Push off, and sitting well in order smite
The sounding furrows; for my purpose holds
To sail beyond the sunset, and the baths
Of all the western stars, until I die.
It may be that the gulfs will wash us down;
It may be we shall touch the Happy Isles,
And see the great Achilles, whom we knew.
Though much is taken, much abides; and though
We are not now that strength which in old days
Moved earth and heaven, that which we are, we are,
One equal temper of heroic hearts,
Made weak by time and fate, but strong in will
To strive, to seek, to find, and not to yield.`,
    source: "https://poets.org/poem/ulysses",
    sourceName: "Academy of American Poets",
    edition: "Public-domain text."
  },
  "go-to-the-limits-of-your-longing": {
    title: "Go to the Limits of Your Longing",
    author: "Rainer Maria Rilke",
    translation: "Translated by Joanna Macy and Anita Barrows",
    textOrigin: "user-provided",
    text: `God speaks to each of us as he makes us,
then walks with us silently out of the night.

These are the words we dimly hear:

You, sent out beyond your recall,
go to the limits of your longing.
Embody me.

Flare up like flame
and make big shadows I can move in.

Let everything happen to you: beauty and terror.
Just keep going. No feeling is final.
Don't let yourself lose me.

Nearby is the country they call life.
You will know it by its seriousness.

Give me your hand.`,
    source: "https://onbeing.org/poetry/go-to-the-limits-of-your-longing/",
    sourceName: "On Being",
    edition: "Book of Hours, I 59. From Rilke’s Book of Hours: Love Poems to God."
  },
  "the-peach-petals": {
    title: "The Peach Petals",
    author: "Hanshan",
    translation: "Translated by A. S. Kline",
    textOrigin: "user-provided",
    text: `The peach petals would like to stay,
But moon and wind blow them on.
You won’t find those ancient men,
Those dynasties are dead and gone.
Day by day the blossoms fall,
Year by year the people go.
Where the dust blows through these heights,
There once shone a silent sea.`,
    source: "https://www.thezengateway.com/culture/poetry/hanshans-poem-with-commentary-by-michael-haggiag",
    sourceName: "The Zen Gateway",
    edition: "A. S. Kline’s English translation."
  },
  "the-peace-of-wild-things": {
    title: "The Peace of Wild Things",
    author: "Wendell Berry",
    textOrigin: "user-provided",
    text: `When despair for the world grows in me
and I wake in the night at the least sound
in fear of what my life and my children’s lives may be,
I go and lie down where the wood drake
rests in his beauty on the water, and the great heron feeds.
I come into the peace of wild things
who do not tax their lives with forethought
of grief. I come into the presence of still water.
And I feel above me the day-blind stars
waiting with their light. For a time
I rest in the grace of the world, and am free.`,
    source: "https://onbeing.org/poetry/the-peace-of-wild-things/",
    sourceName: "On Being",
    edition: "From The Selected Poems of Wendell Berry."
  },
  "eternity": {
    title: "Eternity",
    author: "William Blake",
    text: "He who binds to himself a joy\nDoes the winged life destroy\nHe who kisses the joy as it flies\nLives in eternity's sunrise",
    source: "https://poets.org/poem/eternity",
    sourceName: "Academy of American Poets",
    edition: "Public-domain text."
  },
};

function renderPoem() {
  const slug = new URLSearchParams(window.location.search).get("poem");
  if (!slug) return;

  if (!Object.prototype.hasOwnProperty.call(poems, slug)) {
    document.title = "Poem not found — Milbir Guram";
    document.getElementById("fallback-title").textContent = "Poem not found";
    return;
  }

  const poem = poems[slug];
  document.title = `${poem.title} — ${poem.author} — Milbir Guram`;
  document.querySelector('meta[name="description"]').content = `${poem.title} by ${poem.author}, from Milbir Guram’s favourite poems.`;
  document.getElementById("poem-title").textContent = poem.title;
  document.getElementById("poem-author").textContent = poem.author;

  if (poem.translation) {
    const credit = document.getElementById("poem-translation");
    credit.textContent = poem.translation;
    credit.hidden = false;
  }

  const poemText = document.getElementById("poem-text");
  for (const stanza of poem.text.split("\n\n")) {
    const paragraph = document.createElement("p");
    paragraph.className = "stanza";
    const lines = stanza.split("\n");
    lines.forEach((line, index) => {
      const verse = document.createElement("span");
      verse.className = "verse-line";
      verse.textContent = line;
      paragraph.appendChild(verse);
      if (index < lines.length - 1) paragraph.appendChild(document.createTextNode("\n"));
    });
    poemText.appendChild(paragraph);
  }

  if (poem.excerpt) document.getElementById("excerpt-label").hidden = false;

  const source = document.getElementById("poem-source");
  source.href = poem.source;
  source.textContent = poem.excerpt ? `Read the full poem at ${poem.sourceName} ↗` : `Source: ${poem.sourceName} ↗`;

  if (poem.edition) {
    const edition = document.getElementById("poem-edition");
    edition.textContent = poem.edition;
    edition.hidden = false;
  }

  document.getElementById("poem-fallback").hidden = true;
  document.getElementById("poem-reader").hidden = false;
}

renderPoem();
