export const IDLE = 'idle';
export const ASLEEP = 'asleep';

/**
 * Every mood the mascot can show. A mood's id is also the name of the pose an
 * avatar draws for it. Moods with `when` are the options Jev chooses between;
 * `when` is the criterion Jev reads.
 */
export const MOODS = [
  {
    id: IDLE,
    label: 'hanging out',
    when: 'Routine housekeeping with nothing to react to: an email inbox, a calendar, settings, a blank page.',
  },
  {
    id: 'cheering',
    label: 'cheering',
    when: 'The user just finished or achieved something: a merged pull request, a passing build, an order or booking confirmation, a submitted form, a sent email, a completed lesson.',
  },
  {
    id: 'curious',
    label: 'curious',
    when: 'The user is learning or looking something up: documentation, a tutorial, an encyclopedia article, search results, a long news article.',
  },
  {
    id: 'shocked',
    label: 'shocked',
    when: 'Something alarming or startling: an error or crash page, an outage, breaking news, a security warning, or 60 or more open tabs.',
  },
  {
    id: 'confused',
    label: 'confused',
    when: 'The user looks stuck: searching for an error message, reading a Q&A or troubleshooting page, or returning to the same help page.',
  },
  {
    id: 'sulking',
    label: 'ignoring you',
    when: 'The user has spent 30 or more minutes_on_site on a distracting site such as social media, a forum, or video, and deserves the cold shoulder.',
  },
  {
    id: 'cool',
    label: 'in the zone',
    when: 'The user is getting work done: writing or reviewing code, editing a document, spreadsheet or design, working with an AI assistant or a dashboard. Strongest after several minutes_on_site.',
  },
  {
    id: 'love',
    label: 'feeling the love',
    when: 'Something wholesome or affectionate: messaging friends or family, pet or baby photos, a gift, a wedding, a charity, a thank-you note.',
  },
  {
    id: 'rushing',
    label: 'in a hurry',
    when: 'The user is rushing: 8 or more tab_switches_last_minute, hopping between tabs within seconds.',
  },
  {
    id: 'giggling',
    label: 'giggling',
    when: 'Comedy: memes, funny videos, satire, a joke thread, a comic.',
  },
  {
    id: 'scrolling',
    label: 'doomscrolling',
    when: 'The user is on a feed: a social media timeline, a link aggregator, a news front page, short videos, or 10 or more screens_scrolled_last_minute.',
  },
  {
    id: 'peeking',
    label: 'not looking',
    when: 'The page is private and the mascot should look away: banking, medical records, a password manager, a checkout or payment form, a sign-in page.',
  },
  {
    id: 'grumpy',
    label: 'grumpy',
    when: 'Something frustrating: a failing build, an angry argument or outrage thread, a paywall, a captcha, a cookie wall, a cancelled or delayed order.',
  },
  {
    id: 'cozy',
    label: 'cozy',
    when: 'The user is winding down: streaming shows or movies, browsing a video site, or calm reading late in the evening.',
  },
  {
    id: 'wink',
    label: 'cheeky',
    when: 'A guilty pleasure: a shopping cart, a sale, celebrity gossip, fantasy sports, or something plainly not work during working hours.',
  },
  {
    id: 'snacking',
    label: 'snacking',
    when: 'Food: a recipe, a restaurant menu, food delivery, a grocery order.',
  },
  {
    id: 'dancing',
    label: 'dancing',
    when: 'Music: a music streaming site, a music video, a playlist, a concert page, a radio stream. Strongest with audio_playing.',
  },
  {
    id: 'hiding',
    label: 'hiding',
    when: 'Something dreadful: horror content, a tax form, an overdue bill, exam results, a performance review, a grim headline.',
  },
  { id: ASLEEP, label: 'asleep' },
];

export const moodLabel = (id) => MOODS.find((mood) => mood.id === id)?.label ?? id;
