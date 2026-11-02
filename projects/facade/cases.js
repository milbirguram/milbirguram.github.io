// Facade: the ten cases, in a fixed order chosen for pacing.
//
// Every case is a small world written out in full. The fields the scorer and the tests use:
//
//   kind        'gettier' (justified, true, lucky), 'control' (justified, true, not lucky),
//               'false' (justified but false) or 'pivot' (the evidence you pick decides).
//   invited     the answer the visible evidence supports.
//   answers[]   each answer: { id, text, correct, bases[] }.
//     bases[]   each basis (what you say you are going on):
//               { id, text, source: 'evidence' | 'hunch', tracks, why, noun }
//               tracks = true only when the basis is connected to the fact that makes the
//               chosen answer true: had that fact been otherwise, this evidence would have
//               been otherwise too. A false answer has no such fact, so its bases never track.
//               noun names the basis in the final reflection ("you went on a stopped clock");
//               every basis that can score Right by luck carries one.
//
// Machine-readable structure of the invited belief (what most people will conclude):
//   justified, true, truthmaker, whatTheEvidenceTracks, luckyLink,
//   (truthmaker is the fact that makes the case's true answer true; in a false case that is
//   the fact which makes the invited belief false)
//   intendedOutcomeByEvidenceChoice  { 'answer/basis': 'knew' | 'lucky' | 'wrong' }
//   (the pivot case also carries luckyLinkByEvidence, one flag per basis of the invited answer)
//
// The intended outcomes are written by hand. The tests recompute them from `correct` and
// `tracks` and fail if the two ever disagree.
(function (root) {
  'use strict';

  var CASES = [
    {
      id: 'clock',
      kind: 'gettier',
      title: 'The platform clock',
      story: 'You reach a small country station with a ticket for the 4:20 into the city. Your phone is somewhere at the bottom of your bag and you can’t be bothered to dig for it. Above the platform hangs a large round clock with a white face and black hands. It reads 4:12. Eight minutes, then. You sit on the bench, unwrap a sandwich and watch a crow pull at a crisp packet. Nobody else is waiting.',
      question: 'Is it 4:12?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, it’s 4:12', correct: true, bases: [
          { id: 'clock', text: 'The platform clock reads 4:12', source: 'evidence', tracks: false, noun: 'a stopped clock',
            why: 'The clock stopped on Tuesday when its battery ran flat. It would have said 4:12 whatever the time.' },
          { id: 'sense', text: 'A rough sense of the time of day', source: 'hunch', tracks: false, noun: 'a rough sense of the time',
            why: 'A rough sense of the afternoon cannot pick out 4:12 from 4:05 or 4:20. It landed on the minute by chance.' }
        ] },
        { id: 'no', text: 'No', correct: false, bases: [
          { id: 'doubt', text: 'Clocks at quiet stations are often wrong', source: 'hunch', tracks: false,
            why: 'A fair suspicion about this clock, as it turns out. But the time really was 4:12.' },
          { id: 'light', text: 'The light feels later than four', source: 'hunch', tracks: false,
            why: 'Daylight is a poor clock. It really was 4:12.' }
        ] }
      ],
      facts: 'The clock stopped at 4:12 on Tuesday afternoon, when its battery ran flat, and nobody has changed it. You happened to look up during one of the two minutes a day when a stopped clock is right. Ten minutes earlier, the same glance would have told you the same thing, and you would have been wrong.',
      justified: true,
      true: true,
      truthmaker: 'The time really was 4:12.',
      whatTheEvidenceTracks: 'The moment the battery died on Tuesday, not the time today.',
      luckyLink: true,
      intendedOutcomeByEvidenceChoice: { 'yes/clock': 'lucky', 'yes/sense': 'lucky', 'no/doubt': 'wrong', 'no/light': 'wrong' }
    },

    {
      id: 'landed',
      kind: 'control',
      title: 'Landed',
      story: 'Your friend Amara is flying home from Halifax and you’ve offered to collect her. Her flight is due at 9:05. At 9:11 your phone buzzes: “Down. Taxiing forever.” You open the airline’s app, which takes its arrival times from the airport’s own systems. It shows the flight as Landed at 9:03, with a gate number and a baggage belt. You pick up the car keys and head out.',
      question: 'Has Amara’s plane landed?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, it has landed', correct: true, bases: [
          { id: 'text', text: 'Amara’s text saying she is down', source: 'evidence', tracks: true,
            why: 'She wrote it because she felt the wheels touch the runway. No landing, no message.' },
          { id: 'app', text: 'The airline app showing Landed', source: 'evidence', tracks: true,
            why: 'The app’s status comes from the airport’s arrivals system, which records the touchdown itself.' }
        ] },
        { id: 'no', text: 'Not yet', correct: false, bases: [
          { id: 'joke', text: 'Amara might be teasing; a text proves nothing', source: 'hunch', tracks: false,
            why: 'Possible in principle, but she wasn’t. The plane was on the ground.' },
          { id: 'late', text: 'Evening flights from Halifax often run late', source: 'hunch', tracks: false,
            why: 'Often true. This one was two minutes early, and both the text and the app said so.' }
        ] }
      ],
      facts: 'The plane touched down at 9:03. Amara’s message and the app’s status were both produced by that landing, by different routes: one through a person who felt it, the other through the airport’s records. Had the plane still been circling, neither would have said it was down.',
      justified: true,
      true: true,
      truthmaker: 'The plane touched down at 9:03.',
      whatTheEvidenceTracks: 'The landing itself, through Amara’s experience of it and the airport’s arrivals system.',
      luckyLink: false,
      intendedOutcomeByEvidenceChoice: { 'yes/text': 'knew', 'yes/app': 'knew', 'no/joke': 'wrong', 'no/late': 'wrong' }
    },

    {
      id: 'meeting',
      kind: 'false',
      title: 'The design review',
      story: 'Your calendar says the design review is at 2:00 in Room 4. You accepted the invitation last week, and your calendar has kept you on time for years. At 1:58 you collect a notebook and a coffee and walk down the corridor, going over what you want to say about the new checkout page. The door of Room 4 is shut, which is normal enough. People are often a little early.',
      question: 'Is the design review at 2:00 today?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, at 2:00', correct: false, bases: [
          { id: 'calendar', text: 'My calendar entry', source: 'evidence', tracks: false,
            why: 'The entry still showed last week’s plan. It stopped following the meeting when the meeting moved.' },
          { id: 'invite', text: 'The invitation I accepted', source: 'evidence', tracks: false,
            why: 'The invitation was real, but it described a plan that had since changed.' }
        ] },
        { id: 'no', text: 'No', correct: true, bases: [
          { id: 'moved', text: 'Meetings get moved all the time', source: 'hunch', tracks: false, noun: 'a feeling that meetings move',
            why: 'True in general, and true today. But nothing you had told you that this one had moved.' },
          { id: 'door', text: 'The door of Room 4 is shut', source: 'evidence', tracks: false, noun: 'a shut door',
            why: 'A shut door at 1:58 fits a meeting about to start as well as one long finished. It told you nothing either way.' }
        ] }
      ],
      facts: 'On Monday the organiser moved the review to 11:00, and it finished an hour ago. The update went to your old email address, which nobody reads since the teams merged, so your calendar never changed. Your evidence was good evidence. It pointed at a plan that no longer existed.',
      justified: true,
      true: false,
      truthmaker: 'The review had been moved to 11:00 and was already over.',
      whatTheEvidenceTracks: 'Last week’s plan, before the organiser moved it.',
      luckyLink: false,
      intendedOutcomeByEvidenceChoice: { 'yes/calendar': 'wrong', 'yes/invite': 'wrong', 'no/moved': 'lucky', 'no/door': 'lucky' }
    },

    {
      id: 'forecast',
      kind: 'gettier',
      title: 'The forecast',
      story: 'Before cycling to work you check the weather app. “Rain from 2 p.m.,” it says, with a small grey cloud over the afternoon. It has been right most of this month, so you roll up your rain jacket and pack it. You don’t notice the thin grey bar along the top of the screen, or that your phone has no signal in the basement flat. It rained yesterday afternoon, too.',
      question: 'Will it rain this afternoon?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, it will rain', correct: true, bases: [
          { id: 'app', text: 'The weather app’s forecast', source: 'evidence', tracks: false, noun: 'yesterday’s saved forecast',
            why: 'With no signal, the app showed a forecast it had saved yesterday, for yesterday. It said nothing at all about today.' },
          { id: 'yesterday', text: 'It rained yesterday afternoon', source: 'evidence', tracks: false, noun: 'yesterday’s rain',
            why: 'Yesterday’s rain came from a system that had moved on overnight. It had nothing to do with today’s shower.' }
        ] },
        { id: 'no', text: 'No, it will stay dry', correct: false, bases: [
          { id: 'distrust', text: 'The app has no signal, so I don’t trust it', source: 'hunch', tracks: false,
            why: 'Right not to trust the screen. But a missing forecast is not a forecast of dry weather.' },
          { id: 'twice', text: 'It rarely rains two afternoons running', source: 'hunch', tracks: false,
            why: 'A rule of thumb with nothing behind it here. It did rain again, off the lake.' }
        ] }
      ],
      facts: 'Today’s real forecast, which your phone never downloaded, said dry. Then, at about two, a shower blew in off the lake that the forecasters had missed, and you were glad of the jacket. You were right that it would rain. Nothing you looked at this morning had any connection to the rain that fell.',
      justified: true,
      true: true,
      truthmaker: 'An unforecast shower off the lake at about two.',
      whatTheEvidenceTracks: 'Yesterday’s forecast for yesterday, saved on the phone.',
      luckyLink: true,
      intendedOutcomeByEvidenceChoice: { 'yes/app': 'lucky', 'yes/yesterday': 'lucky', 'no/distrust': 'wrong', 'no/twice': 'wrong' }
    },

    {
      id: 'cold',
      kind: 'control',
      title: 'A cold morning',
      story: 'Early December, just after seven. Through the kitchen window you read the digital thermometer whose probe sits outside, in the shade of the porch. It says −4°C. The probe was replaced in the spring and has behaved well since. On your phone, the town’s weather station, on a mast two streets away, gives its latest reading from ten minutes ago: −4.5°C. You put the kettle on and look for your gloves.',
      question: 'Is it below freezing outside?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, below freezing', correct: true, bases: [
          { id: 'thermometer', text: 'The thermometer reading −4°C', source: 'evidence', tracks: true,
            why: 'The probe responds to the air around it. Had it been 5°C on the porch, it would have read 5°C.' },
          { id: 'station', text: 'The town weather station’s reading', source: 'evidence', tracks: true,
            why: 'The station measures the same air two streets away and reports it every ten minutes. Had the morning been mild, it would have said so.' }
        ] },
        { id: 'no', text: 'No', correct: false, bases: [
          { id: 'mild', text: 'Yesterday felt mild', source: 'hunch', tracks: false,
            why: 'Yesterday was mild. The temperature dropped overnight.' },
          { id: 'town', text: 'Towns stay warmer than the readings suggest', source: 'hunch', tracks: false,
            why: 'Built-up streets can hold a little warmth. Both readings were taken in town, and neither was near zero.' }
        ] }
      ],
      facts: 'It is −4°C. Clear skies let the land lose heat all night, and the air over the whole town cooled with it. The probe on your porch and the station’s sensor each measured that air, in its own place. Had the air been above zero, neither would have read below it.',
      justified: true,
      true: true,
      truthmaker: 'The air outside is at −4°C.',
      whatTheEvidenceTracks: 'The cold air itself, measured by your probe and by the town’s station.',
      luckyLink: false,
      intendedOutcomeByEvidenceChoice: { 'yes/thermometer': 'knew', 'yes/station': 'knew', 'no/mild': 'wrong', 'no/town': 'wrong' }
    },

    {
      id: 'sheep',
      kind: 'pivot',
      title: 'The field',
      story: 'Out walking on a grey afternoon, you stop at a gate and look across a steep field. Near the far wall, a few hundred metres off, is a white, woolly-looking animal with its head down in the grass. As you lean on the gate, the wind carries a sheep’s bleat across to you from the top of the field, where the ground rises out of sight. You take a photo and walk on.',
      question: 'Is there a sheep in this field?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, there’s a sheep', correct: true, bases: [
          { id: 'shape', text: 'The white, woolly animal I can see', source: 'evidence', tracks: false, noun: 'a guardian dog',
            why: 'It was a dog. It would have looked just the same to you if there had been no sheep in the field at all.' },
          { id: 'bleat', text: 'The bleat from the top of the field', source: 'evidence', tracks: true,
            why: 'A ewe made that sound, just over the rise. Had there been no sheep there, you would not have heard it.' }
        ] },
        { id: 'no', text: 'No', correct: false, bases: [
          { id: 'odd', text: 'Something about the animal looks off', source: 'hunch', tracks: false,
            why: 'You were right that the animal was not a sheep. But there were sheep in the field.' },
          { id: 'wind', text: 'The bleat could have carried from the next farm', source: 'hunch', tracks: false,
            why: 'It could have. It didn’t: the ewe was in this field, just over the rise.' }
        ] }
      ],
      facts: 'The white animal is a Maremma, a guardian dog bred to live with a flock and to look much like it from a distance. The flock itself is just over the rise, out of sight, and one ewe bleated while you stood there. Two pieces of evidence pointed the same way. Only one of them came from a sheep.',
      justified: true,
      true: true,
      truthmaker: 'A flock grazing just over the rise, out of sight.',
      whatTheEvidenceTracks: 'It depends which you went on: the white shape is a guardian dog; the bleat is a hidden ewe.',
      luckyLink: true,
      luckyLinkByEvidence: { shape: true, bleat: false },
      intendedOutcomeByEvidenceChoice: { 'yes/shape': 'lucky', 'yes/bleat': 'knew', 'no/odd': 'wrong', 'no/wind': 'wrong' }
    },

    {
      id: 'neighbour',
      kind: 'false',
      title: 'The ladder',
      story: 'Your neighbour Gord borrowed your ladder a fortnight ago, and you would like it back before the weekend. From your front window you can see his blue hatchback in his driveway, and the light in his kitchen is on, as it is most evenings when he’s home. His front curtains are drawn. It is seven o’clock and already dark. You put on your shoes and walk over to knock.',
      question: 'Is Gord at home?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, he’s in', correct: false, bases: [
          { id: 'car', text: 'His car in the drive', source: 'evidence', tracks: false,
            why: 'The car stays at home when he flies. It sat there all week whether he was in or not.' },
          { id: 'light', text: 'His kitchen light', source: 'evidence', tracks: false,
            why: 'The light is on a timer, set so the house looks lived in. It would have come on at dusk either way.' }
        ] },
        { id: 'no', text: 'No, he’s out', correct: true, bases: [
          { id: 'curtains', text: 'His curtains are drawn', source: 'evidence', tracks: false, noun: 'drawn curtains',
            why: 'Gord draws them every evening he is home, and he drew them before he left. They would have looked the same with him on the sofa.' },
          { id: 'hunch', text: 'Just a hunch', source: 'hunch', tracks: false, noun: 'a hunch',
            why: 'A lucky hunch. Nothing you could see told you he was away.' }
        ] }
      ],
      facts: 'Gord left for the airport by taxi at noon, for a week at his daughter’s in Calgary. Before he went, he put the kitchen light on a timer so the house would look occupied. Both of your clues were real, and both were arranged, on purpose, to look exactly as they would if he were in.',
      justified: true,
      true: false,
      truthmaker: 'Gord was in Calgary, at his daughter’s.',
      whatTheEvidenceTracks: 'A parked car and a timer, which look the same whether he is in or not.',
      luckyLink: false,
      intendedOutcomeByEvidenceChoice: { 'yes/car': 'wrong', 'yes/light': 'wrong', 'no/curtains': 'lucky', 'no/hunch': 'lucky' }
    },

    {
      id: 'noodles',
      kind: 'gettier',
      title: 'The noodle bar',
      story: 'You are in an unfamiliar city, hungry and tired. A review site you have never used before lists a noodle bar two streets away: 4.8 stars, “the best hand-pulled noodles in town”, and photographs of glossy bowls under warm light. The site feels a little thin, but you don’t have the energy to compare. You decide to go there for dinner.',
      question: 'Is the noodle bar good?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, it’s good', correct: true, bases: [
          { id: 'rating', text: 'The 4.8-star rating', source: 'evidence', tracks: false, noun: 'a generated rating',
            why: 'The site gives every restaurant between 4.6 and 4.9, including some that have closed. It would have said 4.8 if the food were dreadful.' },
          { id: 'photos', text: 'The photographs of the food', source: 'evidence', tracks: false, noun: 'stock photographs',
            why: 'They were stock photographs of noodles. They show nothing about this kitchen.' }
        ] },
        { id: 'no', text: 'No, probably not', correct: false, bases: [
          { id: 'thin', text: 'The site seems untrustworthy', source: 'hunch', tracks: false,
            why: 'Your suspicion of the site was right. Your conclusion about the noodles was not.' },
          { id: 'online', text: 'Places that look this good online rarely are', source: 'hunch', tracks: false,
            why: 'A fair rule of thumb in a strange city. This time the food was better than the page.' }
        ] }
      ],
      facts: 'The site is a content farm. Its pages are assembled from scraped menus and stock photographs, and its ratings are generated, not earned. The noodle bar happens to be excellent: locals queue for it at weekends. You were right about dinner, and the site you trusted had no idea.',
      justified: true,
      true: true,
      truthmaker: 'The cooks at the noodle bar are very good.',
      whatTheEvidenceTracks: 'A ratings generator and a library of stock photographs.',
      luckyLink: true,
      intendedOutcomeByEvidenceChoice: { 'yes/rating': 'lucky', 'yes/photos': 'lucky', 'no/thin': 'wrong', 'no/online': 'wrong' }
    },

    {
      id: 'bridge',
      kind: 'control',
      title: 'The bridge',
      story: 'You need to cross the river for a dentist’s appointment. The city’s traffic map shows the Ash Street bridge in red, with a closure symbol. From your eighth-floor window you can see the bridge itself: orange barriers across both ends, a crane lifting a section of railing, and cars turning back at the near side. You leave twenty minutes early to go round by the next bridge.',
      question: 'Is the Ash Street bridge closed?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, it’s closed', correct: true, bases: [
          { id: 'window', text: 'The barriers and crane I can see', source: 'evidence', tracks: true,
            why: 'You saw the closure itself. Without it, there would have been no barriers to see.' },
          { id: 'map', text: 'The closure on the city’s map', source: 'evidence', tracks: true,
            why: 'The road crew updates the map when a closure starts and ends, so the map follows the closure.' }
        ] },
        { id: 'no', text: 'No', correct: false, bases: [
          { id: 'stale', text: 'Maps are often out of date', source: 'hunch', tracks: false,
            why: 'Sometimes they are. This one wasn’t, and the barriers were in plain view.' },
          { id: 'night', text: 'Work like that is usually done at night', source: 'hunch', tracks: false,
            why: 'Some of it is. This job closes the bridge for a week, and the barriers were up in daylight.' }
        ] }
      ],
      facts: 'The bridge is closed for a week while its railings are replaced. The city’s map is updated by the road crew when a closure begins and ends. What you saw from the window and what the map showed were both caused by the closure. Take the closure away and both would have been different.',
      justified: true,
      true: true,
      truthmaker: 'The bridge is closed for railing repairs.',
      whatTheEvidenceTracks: 'The closure itself, seen directly and reported by the road crew.',
      luckyLink: false,
      intendedOutcomeByEvidenceChoice: { 'yes/window': 'knew', 'yes/map': 'knew', 'no/stale': 'wrong', 'no/night': 'wrong' }
    },

    {
      id: 'dog',
      kind: 'gettier',
      title: 'Someone on the team',
      story: 'On the weekly video call you notice that Dana’s background is a framed photo of a beagle, and halfway through she apologises: she has to take him out at four. You have been asked to count how many people on your team of six might come to a bring-your-dog afternoon, and you write down that at least one person on the team has a dog.',
      question: 'Does someone on your team have a dog?',
      invited: 'yes',
      answers: [
        { id: 'yes', text: 'Yes, someone does', correct: true, bases: [
          { id: 'photo', text: 'Dana’s beagle photo', source: 'evidence', tracks: false, noun: 'a photo of a neighbour’s beagle',
            why: 'The beagle is her neighbour’s. The photo would be there whether or not anyone on the team owned a dog.' },
          { id: 'walk', text: 'Dana saying she has to take him out', source: 'evidence', tracks: false, noun: 'a dog-walking job',
            why: 'She walks her neighbour’s dog for a bit of extra money. It is not her dog.' }
        ] },
        { id: 'no', text: 'No', correct: false, bases: [
          { id: 'office', text: 'No one has ever brought a dog to work', source: 'hunch', tracks: false,
            why: 'No one had. But someone on the team does have one.' },
          { id: 'odds', text: 'With only six people, the odds are against it', source: 'hunch', tracks: false,
            why: 'With six people the odds were never strongly either way. As it happens, Theo has a greyhound.' }
        ] }
      ],
      facts: 'The beagle belongs to Dana’s neighbour; Dana walks him on weekdays for a bit of extra money. She has no dog. But Theo, who rarely turns his camera on, has an old greyhound asleep under his desk most afternoons. Someone on your team does have a dog. It just isn’t the one you were thinking of.',
      justified: true,
      true: true,
      truthmaker: 'Theo owns an old greyhound.',
      whatTheEvidenceTracks: 'Dana’s dog-walking arrangement with her neighbour.',
      luckyLink: true,
      intendedOutcomeByEvidenceChoice: { 'yes/photo': 'lucky', 'yes/walk': 'lucky', 'no/office': 'wrong', 'no/odds': 'wrong' }
    }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = CASES;
  else root.FacadeCases = CASES;
})(typeof window !== 'undefined' ? window : this);
