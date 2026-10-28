"use strict";

// Keep modern poems and translations as short excerpts with links to their sources.
// The five complete texts below are public-domain editions verified at the linked sources.
const poems = {
  "change": {
    title: "Change",
    author: "Kathleen Raine",
    excerpt: true,
    text: "Change\nSaid the sun to the moon,\nYou cannot stay.",
    note: "The changing natural world becomes an invitation to loosen our hold on what we know. Beauty emerges through transformation, even when that transformation asks something difficult of us.",
    source: "https://voetica.com/poem/16064",
    sourceName: "Voetica",
    edition: "Excerpt from “Change” by Kathleen Raine."
  },
  "this-dewdrop-world": {
    title: "This Dewdrop World",
    author: "Kobayashi Issa",
    translation: "Translated by Lewis Mackenzie",
    excerpt: true,
    text: "This dewdrop world—",
    note: "An understanding of impermanence meets the stubborn tenderness of grief. This small poem leaves room for the feelings that a spiritual explanation cannot make disappear.",
    source: "https://thedewdrop.org/2021/03/24/issa-this-dewdrop-world/",
    sourceName: "The Dewdrop",
    edition: "Opening line of the translation in The Autumn Wind."
  },
  "the-guest-house": {
    title: "The Guest House",
    author: "Rumi",
    translation: "English version by Coleman Barks",
    excerpt: true,
    text: "This being human is a guest house.\nEvery morning a new arrival.",
    note: "Inner peace begins with hospitality toward our changing emotional lives. Even difficult feelings can be met with attention and generosity, allowing acceptance to become an active practice.",
    source: "https://www.scottishpoetrylibrary.org.uk/poem/guest-house/",
    sourceName: "Scottish Poetry Library",
    edition: "From Rumi: Selected Poems (Penguin, 2004), credited to Coleman Barks with John Moynce, A. J. Arberry, and Reynold Nicholson."
  },
  "little-gidding": {
    title: "Little Gidding",
    author: "T. S. Eliot",
    excerpt: true,
    text: "We shall not cease from exploration\nAnd the end of all our exploring",
    note: "Prayer, memory, and the difficult work of reconciliation gradually lead toward a simpler form of love. The poem’s peace is reached through a sustained encounter with suffering and history.",
    source: "https://voetica.com/poem/2151",
    sourceName: "Voetica",
    edition: "Excerpt from section V of Little Gidding, the fourth of Eliot’s Four Quartets."
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
  "sailing-to-byzantium": {
    title: "Sailing to Byzantium",
    author: "W. B. Yeats",
    text: `That is no country for old men. The young
In one another’s arms, birds in the trees
—Those dying generations—at their song,
The salmon-falls, the mackerel-crowded seas,
Fish, flesh, or fowl, commend all summer long
Whatever is begotten, born, and dies.
Caught in that sensual music all neglect
Monuments of unageing intellect.

An aged man is but a paltry thing,
A tattered coat upon a stick, unless
Soul clap its hands and sing, and louder sing
For every tatter in its mortal dress,
Nor is there singing school but studying
Monuments of its own magnificence;
And therefore I have sailed the seas and come
To the holy city of Byzantium.

O sages standing in God’s holy fire
As in the gold mosaic of a wall,
Come from the holy fire, perne in a gyre,
And be the singing-masters of my soul.
Consume my heart away; sick with desire
And fastened to a dying animal
It knows not what it is; and gather me
Into the artifice of eternity.

Once out of nature I shall never take
My bodily form from any natural thing,
But such a form as Grecian goldsmiths make
Of hammered gold and gold enamelling
To keep a drowsy Emperor awake;
Or set upon a golden bough to sing
To lords and ladies of Byzantium
Of what is past, or passing, or to come.`,
    source: "https://poets.org/poem/sailing-byzantium",
    sourceName: "Academy of American Poets",
    edition: "Public-domain text."
  },
  "go-to-the-limits-of-your-longing": {
    title: "Go to the Limits of Your Longing",
    author: "Rainer Maria Rilke",
    translation: "Translated by Joanna Macy and Anita Barrows",
    excerpt: true,
    text: "Let everything happen to you: beauty and terror.\nJust keep going. No feeling is final.",
    note: "A voice of divine companionship calls us into the whole of life. Beauty and uncertainty belong to the same journey, and courage grows from remaining open to both.",
    source: "https://onbeing.org/poetry/go-to-the-limits-of-your-longing/",
    sourceName: "On Being",
    edition: "Book of Hours, I 59. From Rilke’s Book of Hours: Love Poems to God."
  },
  "the-peach-petals": {
    title: "The Peach Petals",
    author: "Hanshan",
    translation: "Translated by A. S. Kline",
    excerpt: true,
    text: "The peach petals would like to stay,\nBut moon and wind blow them on.",
    note: "Falling blossoms open onto the passing of lives, dynasties, and landscapes. The poem asks us to see beauty clearly while recognising that nothing we love can remain unchanged.",
    source: "https://www.thezengateway.com/culture/poetry/hanshans-poem-with-commentary-by-michael-haggiag",
    sourceName: "The Zen Gateway",
    edition: "Excerpt from A. S. Kline’s English translation."
  },
  "the-peace-of-wild-things": {
    title: "The Peace of Wild Things",
    author: "Wendell Berry",
    excerpt: true,
    text: "I come into the peace of wild things",
    note: "An anxious mind finds a brief freedom in the life around it. Still water, birds, and stars restore a sense of belonging without requiring the world’s troubles to disappear.",
    source: "https://onbeing.org/poetry/the-peace-of-wild-things/",
    sourceName: "On Being",
    edition: "Excerpt from The Selected Poems of Wendell Berry."
  },
  "on-joy-and-sorrow": {
    title: "On Joy and Sorrow",
    author: "Kahlil Gibran",
    text: `Then a woman said, Speak to us of Joy and Sorrow.
And he answered:
Your joy is your sorrow unmasked.
And the selfsame well from which your laughter rises was oftentimes filled with your tears.
And how else can it be?
The deeper that sorrow carves into your being, the more joy you can contain.
Is not the cup that holds your wine the very cup that was burned in the potter’s oven?
And is not the lute that soothes your spirit, the very wood that was hollowed with knives?
When you are joyous, look deep into your heart and you shall find it is only that which has given you sorrow that is giving you joy.
When you are sorrowful look again in your heart, and you shall see that in truth you are weeping for that which has been your delight.
Some of you say, “Joy is greater than sorrow,” and others say, “Nay, sorrow is the greater.”
But I say unto you, they are inseparable.
Together they come, and when one sits alone with you at your board, remember that the other is asleep upon your bed.

Verily you are suspended like scales between your sorrow and your joy.
Only when you are empty are you at standstill and balanced.
When the treasure-keeper lifts you to weigh his gold and his silver, needs must your joy or your sorrow rise or fall.`,
    source: "https://poets.org/poem/joy-and-sorrow",
    sourceName: "Academy of American Poets",
    edition: "From The Prophet (1923). Public-domain text."
  },
  "eternity": {
    title: "Eternity",
    author: "William Blake",
    text: "He who binds to himself a joy\nDoes the winged life destroy\nHe who kisses the joy as it flies\nLives in eternity's sunrise",
    source: "https://poets.org/poem/eternity",
    sourceName: "Academy of American Poets",
    edition: "Public-domain text."
  },
  "peace-my-heart": {
    title: "Peace, My Heart",
    author: "Rabindranath Tagore",
    translation: "Translated from Bengali by the author",
    text: `PEACE, my heart, let the time for the parting be sweet.
Let it not be a death but completeness.
Let love melt into memory and pain into songs.
Let the flight through the sky end in the folding of the wings over the nest.
Let the last touch of your hands be gentle like the flower of the night.
Stand still, O Beautiful End, for a moment, and say your last words in silence.
I bow to you and hold up my lamp to light you on your way.`,
    source: "https://en.wikisource.org/wiki/The_Gardener_(Tagore)/61",
    sourceName: "Wikisource",
    edition: "The Gardener, no. 61 (1913). Public-domain text."
  }
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
  if (poem.note) {
    const note = document.getElementById("poem-note");
    note.textContent = poem.note;
    document.getElementById("poem-note-section").hidden = false;
  }

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
