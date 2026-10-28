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
  "traveler-your-footprints": {
    title: "Traveler, your footprints",
    author: "Antonio Machado",
    translation: "Translated by Mary G. Berg and Dennis Maloney",
    textOrigin: "user-provided",
    text: `Traveler, your footprints
are the only road, nothing else.
Traveler, there is no road;
you make your own path as you walk.
As you walk, you make your own road,
and when you look back
you see the path
you will never travel again.
Traveler, there is no road;
only a ship's wake on the sea.`,
    source: "https://www.poetryfoundation.org/poems/58815/traveler-your-footprints",
    sourceName: "Poetry Foundation",
    edition: "From There Is No Road (White Pine Press, 2003)."
  },
  "dust-of-snow": {
    title: "Dust of Snow",
    author: "Robert Frost",
    textOrigin: "user-provided",
    text: `The way a crow
Shook down on me
The dust of snow
From a hemlock tree

Has given my heart
A change of mood
And saved some part
Of a day I had rued.`,
    source: "https://poets.org/poem/dust-snow/print",
    sourceName: "Academy of American Poets",
    edition: "From New Hampshire (1923). Public-domain text."
  },
  "to-be-of-use": {
    title: "To be of use",
    author: "Marge Piercy",
    textOrigin: "user-provided",
    text: `The people I love the best
jump into work head first
without dallying in the shallows
and swim off with sure strokes almost out of sight.
They seem to become natives of that element,
the black sleek heads of seals
bouncing like half-submerged balls.

I love people who harness themselves, an ox to a heavy cart,
who pull like water buffalo, with massive patience,
who strain in the mud and the muck to move things forward,
who do what has to be done, again and again.

I want to be with people who submerge
in the task, who go into the fields to harvest
and work in a row and pass the bags along,
who are not parlor generals and field deserters
but move in a common rhythm
when the food must come in or the fire be put out.

The work of the world is common as mud.
Botched, it smears the hands, crumbles to dust.
But the thing worth doing well done
has a shape that satisfies, clean and evident.
Greek amphoras for wine or oil,
Hopi vases that held corn, are put in museums
but you know they were made to be used.
The pitcher cries for water to carry
and a person for work that is real.`,
    source: "https://www.poetryfoundation.org/poems/57673/to-be-of-use",
    sourceName: "Poetry Foundation",
    edition: ""
  },
  "widening-circles": {
    title: "Widening Circles",
    author: "Rainer Maria Rilke",
    translation: "Translated by Joanna Macy and Anita Barrows",
    textOrigin: "user-provided",
    text: `I live my life in widening circles
that reach out across the world.
I may not complete this last one
but I give myself to it.

I circle around God, around the primordial tower.
I’ve been circling for thousands of years
and I still don’t know: am I a falcon,
a storm, or a great song?`,
    source: "https://onbeing.org/poetry/widening-circles/",
    sourceName: "On Being",
    edition: "From Rilke’s Book of Hours: Love Poems to God."
  },
  "the-way-it-is": {
    title: "The Way It Is",
    author: "William Stafford",
    textOrigin: "user-provided",
    text: `There’s a thread you follow. It goes among
things that change. But it doesn’t change.
People wonder about what you are pursuing.
You have to explain about the thread.
But it is hard for others to see.
While you hold it you can’t get lost.
Tragedies happen; people get hurt
or die; and you suffer and get old.
Nothing you do can stop time’s unfolding.
You don’t ever let go of the thread.`,
    source: "https://ptgmedia.pearsoncmg.com/images/9780132498289/samplepages/0132498286.pdf#page=14",
    sourceName: "Pearson (PDF, page 14)",
    edition: "Publisher excerpt credits permission to Graywolf Press."
  },
  "working-together": {
    title: "Working Together",
    author: "David Whyte",
    textOrigin: "user-provided",
    text: `We shape our self
to fit this world
and by the world
are shaped again.

The visible
and the invisible
working together
in common cause,
to produce
the miraculous.

I am thinking of the way
the intangible air
traveled at speed
round a shaped wing
easily
holds our weight.

So may we, in this life
trust
to those elements
we have yet to see
or imagine,
and look for the true
shape of our own self,
by forming it well
to the great
intangibles about us.`,
    source: "https://onbeing.org/poetry/working-together/",
    sourceName: "On Being",
    edition: ""
  },
  "the-door": {
    title: "The Door",
    author: "Miroslav Holub",
    translation: "Translated by Ian Milner",
    textOrigin: "user-provided",
    text: `Go and open the door.
Maybe outside there’s
a tree, or a wood,
a garden,
or a magic city.

Go and open the door.
Maybe a dog’s rummaging.
Maybe you’ll see a face,
or an eye,
or the picture
of a picture.

Go and open the door.
If there’s a fog
it will clear.

Go and open the door.
Even if there’s only
the darkness ticking,
even if there’s only
the hollow wind,
even if
nothing
is there,
go and open the door.

At least
there’ll be
a draught.`,
    source: "https://www.scottishpoetrylibrary.org.uk/poem/door/",
    sourceName: "Scottish Poetry Library",
    edition: ""
  },
  "aedh-wishes-for-the-cloths-of-heaven": {
    title: "Aedh Wishes for the Cloths of Heaven",
    author: "W. B. Yeats",
    textOrigin: "user-provided",
    text: `Had I the heavens’ embroidered cloths,
Enwrought with golden and silver light,
The blue and the dim and the dark cloths
Of night and light and the half light,
I would spread the cloths under your feet:
But I, being poor, have only my dreams;
I have spread my dreams under your feet;
Tread softly because you tread on my dreams.`,
    source: "https://poets.org/poem/aedh-wishes-cloths-heaven",
    sourceName: "Academy of American Poets",
    edition: ""
  },
  "ithaka": {
    title: "Ithaka",
    author: "C. P. Cavafy",
    translation: "Translated by Edmund Keeley and Philip Sherrard",
    textOrigin: "user-provided",
    text: `As you set out for Ithaka
hope your road is a long one,
full of adventure, full of discovery.
Laistrygonians, Cyclops,
angry Poseidon—don’t be afraid of them:
you’ll never find things like that on your way
as long as you keep your thoughts raised high,
as long as a rare excitement
stirs your spirit and your body.
Laistrygonians, Cyclops,
wild Poseidon—you won’t encounter them
unless you bring them along inside your soul,
unless your soul sets them up in front of you.

Hope your road is a long one.
May there be many summer mornings when,
with what pleasure, what joy,
you enter harbors you’re seeing for the first time;
may you stop at Phoenician trading stations
to buy fine things,
mother of pearl and coral, amber and ebony,
sensual perfume of every kind—
as many sensual perfumes as you can;
and may you visit many Egyptian cities
to learn and go on learning from their scholars.

Keep Ithaka always in your mind.
Arriving there is what you’re destined for.
But don’t hurry the journey at all.
Better if it lasts for years,
so you’re old by the time you reach the island,
wealthy with all you’ve gained on the way,
not expecting Ithaka to make you rich.

Ithaka gave you the marvelous journey.
Without her you wouldn't have set out.
She has nothing left to give you now.

And if you find her poor, Ithaka won’t have fooled you.
Wise as you will have become, so full of experience,
you’ll have understood by then what these Ithakas mean.`,
    source: "https://www.poetryfoundation.org/poems/51296/ithaka-56d22eef917ec",
    sourceName: "Poetry Foundation",
    edition: ""
  },
  "blessing-the-boats": {
    title: "blessing the boats",
    author: "Lucille Clifton",
    textOrigin: "user-provided",
    text: `may the tide
that is entering even now
the lip of our understanding
carry you out
beyond the face of fear
may you kiss
the wind then turn from it
certain that it will
love your back     may you
open your eyes to water
water waving forever
and may you in your innocence
sail through this to that`,
    source: "https://www.poetryfoundation.org/poems/58816/blessing-the-boats",
    sourceName: "Poetry Foundation",
    edition: ""
  },
  "temple-bells-die-out": {
    title: "Temple Bells Die Out",
    author: "Matsuo Bashō",
    translation: "Translated by Daniel C. Buchanan",
    textOrigin: "user-provided",
    text: `Temple bells die out
The fragrant blossoms remain
A perfect evening.`,
    source: "https://www.encyclopedia.com/arts/educational-magazines/temple-bells-die-out",
    sourceName: "Encyclopedia.com",
    edition: ""
  },
  "from-march-1979": {
    title: "From March 1979",
    author: "Tomas Tranströmer",
    translation: "Translated by Robin Robertson",
    textOrigin: "user-provided",
    text: `Sick of those who come with words, words but no language,
I make my way to the snow-covered island.

Wilderness has no words. The unwritten pages
stretch out in all directions.

I come across this line of deer-slots in the snow: a language,
language without words.`,
    source: "https://fsgworkinprogress.com/2015/04/07/from-march-1979/",
    sourceName: "Farrar, Straus and Giroux",
    edition: ""
  },
  "a-note": {
    title: "A Note",
    author: "Wisława Szymborska",
    translation: "Translated by Stanisław Barańczak and Clare Cavanagh",
    textOrigin: "user-provided",
    text: `Life is the only way
to get covered in leaves,
catch your breath on the sand,
rise on wings;

to be a dog,
or stroke its warm fur;

to tell pain
from everything it’s not;

to squeeze inside events,
dawdle in views,
to seek the least of all possible mistakes.

An extraordinary chance
to remember for a moment
a conversation held
with the lamp switched off;

and if only once
to stumble on a stone,
end up drenched in one downpour or another,

mislay your keys in the grass;
and to follow a spark on the wind with your eyes;

and to keep on not knowing
something important.`,
    source: "https://www.newyorker.com/magazine/2005/11/28/a-note-2",
    sourceName: "The New Yorker",
    edition: ""
  },
  "love-after-love": {
    title: "Love After Love",
    author: "Derek Walcott",
    textOrigin: "user-provided",
    text: `The time will come
when, with elation,
you will greet yourself arriving
at your own door, in your own mirror,
and each will smile at the other’s welcome,

and say, sit here. Eat.
You will love again the stranger who was your self.
Give wine. Give bread. Give back your heart
to itself, to the stranger who has loved you

all your life, whom you ignored
for another, who knows you by heart.
Take down the love letters from the bookshelf,

the photographs, the desperate notes,
peel your own image from the mirror.
Sit. Feast on your life.`,
    source: "https://poets.org/poem/love-after-love",
    sourceName: "Academy of American Poets",
    edition: ""
  },
  "wind-water-stone": {
    title: "Wind, Water, Stone",
    author: "Octavio Paz",
    translation: "Translated by Eliot Weinberger",
    textOrigin: "user-provided",
    text: `Water hollows stone,
wind scatters water,
stone stops the wind.
Water, wind, stone.

Wind carves stone,
stone's a cup of water,
water escapes and is wind.
Stone, wind, water.

Wind sings in its whirling,
water murmurs going by,
unmoving stone keeps still.
Wind, water, stone.

Each is another and no other:
crossing and vanishing
through their empty names:
water, stone, wind.`,
    source: "https://www.poetryfoundation.org/poems/58334/wind-water-stone",
    sourceName: "Poetry Foundation",
    edition: ""
  },
  "the-more-loving-one": {
    title: "The More Loving One",
    author: "W. H. Auden",
    textOrigin: "user-provided",
    text: `Looking up at the stars, I know quite well
That, for all they care, I can go to hell,
But on earth indifference is the least
We have to dread from man or beast.

How should we like it were stars to burn
With a passion for us we could not return?
If equal affection cannot be,
Let the more loving one be me.

Admirer as I think I am
Of stars that do not give a damn,
I cannot, now I see them, say
I missed one terribly all day.

Were all stars to disappear or die,
I should learn to look at an empty sky
And feel its total dark sublime,
Though this might take me a little time.`,
    source: "https://poets.org/poem/more-loving-one",
    sourceName: "Academy of American Poets",
    edition: ""
  },
  "the-good-life": {
    title: "The Good Life",
    author: "Tracy K. Smith",
    textOrigin: "user-provided",
    text: `When some people talk about money
They speak as if it were a mysterious lover
Who went out to buy milk and never
Came back, and it makes me nostalgic
For the years I lived on coffee and bread,
Hungry all the time, walking to work on payday
Like a woman journeying for water
From a village without a well, then living
One or two nights like everyone else
On roast chicken and red wine.`,
    source: "https://www.poetryfoundation.org/poems/56376/the-good-life",
    sourceName: "Poetry Foundation",
    edition: ""
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
