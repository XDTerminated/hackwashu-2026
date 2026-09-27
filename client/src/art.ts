// Hand-authored pixel art. Each sprite is rows of characters indexed into a
// palette; "." is transparent. Every row in a frame must be the same width.
//
// The little Claude critters are NOT here — they're rasterized from polar math
// in textures.ts so the stars stay crisp.

export interface PixelSprite {
  palette: Record<string, string>;
  frames: string[][];
}

// ---------------------------------------------------------------- astronaut
// 20 x 26, composed from a head + torso + legs so walk cycles stay in sync.

const SUIT = {
  K: "#3b2a3a", // outline
  W: "#f6efe2", // suit cream
  S: "#cbbfd6", // suit shade (lavender)
  V: "#1f3a4d", // visor glass
  L: "#4fa8b8", // visor reflection
  l: "#c8f4ff", // visor highlight
  O: "#e0708a", // rose trim
  o: "#b44f6c", // rose shade
  G: "#8a7f9c", // life-support pack
  B: "#6b4a3a", // leather boots
};

const HEAD_DOWN = [
  "......KKKKKKKK......",
  "....KKWWWWWWWWKK....",
  "...KWWWWWWWWWWWWK...",
  "..KWWWWWWWWWWWWWWK..",
  "..KWWKKKKKKKKKKWWK..",
  "..KWKVVVVVVVVVVKWK..",
  "..KWKVllVVVVVVVKWK..",
  "..KWKVlLVVVVVVVKWK..",
  "..KWKVVLLVVVVVVKWK..",
  "..KWKVVVVVVVVVVKWK..",
  "..KWWKKKKKKKKKKWWK..",
  "...KWWWWWWWWWWWWK...",
  "....KKWWWWWWWWKK....",
];

const HEAD_UP = [
  "......KKKKKKKK......",
  "....KKWWWWWWWWKK....",
  "...KWWWWWWWWWWWWK...",
  "..KWWWWWWWWWWWWWWK..",
  "..KWWWWWWWWWWWWWWK..",
  "..KWWWGGGGGGGGWWWK..",
  "..KWWGGGGGGGGGGWWK..",
  "..KWWGGGOOOOGGGWWK..",
  "..KWWGGGGGGGGGGWWK..",
  "..KWWWGGGGGGGGWWWK..",
  "..KWWWWWWWWWWWWWWK..",
  "...KWWWWWWWWWWWWK...",
  "....KKWWWWWWWWKK....",
];

const HEAD_SIDE = [
  ".....KKKKKKKK.......",
  "...KKWWWWWWWWKK.....",
  "..KWWWWWWWWWWWWK....",
  ".KWWWWWWWWWWWWWWK...",
  ".KWWGKKKKKKKKKWWK...",
  ".KWGGKVVVVVVVVKWK...",
  ".KWGGKVllVVVVVKWK...",
  ".KWGGKVlLVVVVVKWK...",
  ".KWGGKVVVVVVVVKWK...",
  ".KWWGKKKKKKKKKWWK...",
  "..KWWWWWWWWWWWWK....",
  "...KKWWWWWWWWKK.....",
  "....KKWWWWWWKK......",
];

const TORSO_DOWN = [
  "..KKWWWWWWWWWWWWKK..",
  ".KWWWWWWWWWWWWWWWWK.",
  ".KWWKWWWWWWWWWWKWWK.",
  ".KWWKWWOOOOOOWWKWWK.",
  ".KWWKWWOooooOWWKWWK.",
  ".KWWKWWOOOOOOWWKWWK.",
  ".KWWKWWWWWWWWWWKWWK.",
  ".KOOKWWWWWWWWWWKOOK.",
];

const TORSO_UP = [
  "..KKWWWWWWWWWWWWKK..",
  ".KWWWWWWWWWWWWWWWWK.",
  ".KWWKWGGGGGGGGWKWWK.",
  ".KWWKWGGGGGGGGWKWWK.",
  ".KWWKWGGGGGGGGWKWWK.",
  ".KWWKWGGGGGGGGWKWWK.",
  ".KWWKWWWWWWWWWWKWWK.",
  ".KOOKWWWWWWWWWWKOOK.",
];

const TORSO_SIDE = [
  ".KKWWWWWWWWWWWWKK...",
  "KWGGWWWWWWWWWWWWWK..",
  "KWGGWWWWWWWWWWWWWK..",
  "KWGGWWWOOOOOOWWWWK..",
  "KWGGWWWOooooOWWWWK..",
  "KWGGWWWOOOOOOWWWWK..",
  "KWWGWWWWWWWWWWWWWK..",
  "KWWWWWWWWWWWWWOOK...",
];

const LEGS_IDLE = [
  "....KWWWWWWWWWWK....",
  "....KWWWKKKKWWWK....",
  "....KWWWK..KWWWK....",
  "....KBBBK..KBBBK....",
  "...KBBBBK..KBBBBK...",
];

const LEGS_WALK_A = [
  "....KWWWWWWWWWWK....",
  "...KWWWKKKKKKWWWK...",
  "...KWWWK....KWWWK...",
  "...KBBBK....KBBBK...",
  "..KBBBBK....KBBBBK..",
];

const LEGS_WALK_B = [
  "....KWWWWWWWWWWK....",
  "....KWWWWKKWWWWK....",
  ".....KWWWKKWWWK.....",
  ".....KBBBKKBBBK.....",
  "....KBBBBKKBBBBK....",
];

const SIDE_LEGS_IDLE = [
  "...KWWWWWWWWWWK.....",
  "...KWWWWWWWWWWK.....",
  "....KWWWWWWWWK......",
  "....KBBBBBBBBK......",
  "...KBBBBBBBBBK......",
];

const SIDE_LEGS_A = [
  "...KWWWWWWWWWWK.....",
  "...KWWWKKKWWWWK.....",
  "..KWWWK...KWWWK.....",
  "..KBBBK....KBBBK....",
  ".KBBBBK.....KBBBK...",
];

const SIDE_LEGS_B = [
  "...KWWWWWWWWWWK.....",
  "...KWWWWKKKWWWK.....",
  "...KWWWK..KWWWWK....",
  "...KBBBK...KBBBBK...",
  "..KBBBBK....KBBBK...",
];

const frame = (...parts: string[][]) => parts.flat();

/**
 * Frame order matters — textures.ts registers these as astro_0..astro_8 and
 * buildAnims() indexes them by position.
 *   0-2 down (idle, walk A, walk B)
 *   3-5 up
 *   6-8 side (drawn facing right; flipX for left)
 */
export const astronaut: PixelSprite = {
  palette: SUIT,
  frames: [
    frame(HEAD_DOWN, TORSO_DOWN, LEGS_IDLE),
    frame(HEAD_DOWN, TORSO_DOWN, LEGS_WALK_A),
    frame(HEAD_DOWN, TORSO_DOWN, LEGS_WALK_B),
    frame(HEAD_UP, TORSO_UP, LEGS_IDLE),
    frame(HEAD_UP, TORSO_UP, LEGS_WALK_A),
    frame(HEAD_UP, TORSO_UP, LEGS_WALK_B),
    frame(HEAD_SIDE, TORSO_SIDE, SIDE_LEGS_IDLE),
    frame(HEAD_SIDE, TORSO_SIDE, SIDE_LEGS_A),
    frame(HEAD_SIDE, TORSO_SIDE, SIDE_LEGS_B),
  ],
};

// ------------------------------------------------------------------ villagers
// 18 x 22 each, two frames of idle animation.

const RABBIT_BODY = [
  "....KWKKKKKKWK....",
  "...KKWWWWWWWWKK...",
  "..KWWWWWWWWWWWWK..",
  "..KWWKKWWWWKKWWK..",
  "..KWWKKWWWWKKWWK..",
  "..KWWWWWPPWWWWWK..",
  "..KWWWWWWWWWWWWK..",
  "...KWWWWWWWWWWK...",
  "...KGGGGGGGGGGK...",
  "..KGGGGGGGGGGGGK..",
  "..KGWWWWWWWWWWGK..",
  "..KGWWWWWWWWWWGK..",
  "..KGGWWWWWWWWGGK..",
  "..KWWWWWWWWWWWWK..",
  "...KWWK....KWWK...",
  "...KSSK....KSSK...",
];

export const jadeRabbit: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    W: "#f6f6fa",
    S: "#c9c9dc",
    P: "#f0a8bc",
    G: "#3f9b7c",
  },
  frames: [
    [
      "....KK......KK....",
      "...KWWK....KWWK...",
      "...KWPK....KWPK...",
      "...KWPK....KWPK...",
      "...KWPK....KWPK...",
      "...KWWK....KWWK...",
      ...RABBIT_BODY,
    ],
    [
      "...KK.......KK....",
      "..KWWK.....KWWK...",
      "..KWPK.....KWPK...",
      "...KWPK....KWPK...",
      "...KWPK....KWPK...",
      "...KWWK....KWWK...",
      ...RABBIT_BODY,
    ],
  ],
};

const POST_BODY = [
  "..KnnnWWbbWWWnnK..",
  "..KnnnnnnnnnnnnK..",
  "..KnmmnnnnnnmmnK..",
  "..KnmmnOOOOnmmnK..",
  "..KnmmnOOOOnmmnK..",
  "..KnnmnnnnnnmnnK..",
  "..KnnnnnnnnnnnnK..",
  "...KnnnnnnnnnnK...",
  "....KnnnnnnnnK....",
  ".....KKnnnnKK.....",
  "......KbbbbK......",
  ".....KbbKKbbK.....",
];

const POST_TOP = [
  "......KKKKKK......",
  "....KKBBBBBBKK....",
  "...KBBBBBBBBBBK...",
  "...KBBBBBBBBBBK...",
  "....KKKKKKKKKK....",
  "...KnnnnnnnnnnK...",
  "..KnnWWWWWWWWnnK..",
];

export const postmaster: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    n: "#8a6a4a",
    m: "#a88257",
    W: "#f4ead8",
    Y: "#f5c542",
    k: "#241a16",
    b: "#e08a3c",
    B: "#3f5aa0",
    O: "#e0708a",
  },
  frames: [
    [
      ...POST_TOP,
      "..KnWYYkWWkYYWnK..",
      "..KnWYYkWWkYYWnK..",
      "..KnnWWWbbWWWWnK..",
      ...POST_BODY,
    ],
    [
      ...POST_TOP,
      "..KnnWWWWWWWWnnK..",
      "..KnWkkkWWkkkWnK..",
      "..KnnWWWbbWWWWnK..",
      ...POST_BODY,
    ],
  ],
};

const CHAT_BODY = [
  ".....KKKKKKKK.....",
  "...KKccccccccKK...",
  "..KccccccccccccK..",
  ".KccccccccccccccK.",
  ".KcWWccccccccWWcK.",
  ".KcWkWccccccWkWcK.",
  ".KcWWWccccccWWWcK.",
  ".KccccccppccccccK.",
  ".KccccccccccccccK.",
  "..KcCCCccccCCCcK..",
  "..KcCCCccccCCCcK..",
  "..KccOOOOOOOOccK..",
  "..KccOOOOOOOOccK..",
  "..KcccccccccccK...",
  "...KccccccccK.....",
  "....KccK..KccK....",
  "....KWWK..KWWK....",
];

const SCHOLAR_BODY = [
  "..KbgggbbbbgggbK..",
  "..KbbbbbnnbbbbbK..",
  "...KblllllllllK...",
  "....KKwwwwwwKK....",
  "...KrrrwwwwrrrK...",
  "..KrRrrrrrrrrRrK..",
  "..KrRrrrrrrrrRrK..",
  "..KprrrrrrrrrrpK..",
  "..KKrrrrrrrrrrKK..",
  "...KrrrrrrrrrrK...",
  "....KbbK..KbbK....",
  "....KppK..KppK....",
];

/** Bespectacled moon-mole in a mortarboard (and a WashU-red sweater). */
export const scholar: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    b: "#8a6a5a",
    l: "#b08a78",
    c: "#2e2a3a",
    t: "#f5c542",
    g: "#d9a441",
    e: "#c8f4ff",
    k: "#241a16",
    n: "#f0a8bc",
    r: "#a51417",
    R: "#c8323a",
    w: "#fff6ee",
    p: "#d8b0a0",
  },
  frames: [
    [
      "..................",
      "..................",
      "......KKKKKK......",
      "..KKKKccccccKKKK..",
      ".KccccccccccccccK.",
      "..KKKKccccccKKKt..",
      "....KbbbbbbbbK.t..",
      "...KbbbbbbbbbbKt..",
      "..KbgggbbbbgggbK..",
      "..KbgekgbbgkegbK..",
      ...SCHOLAR_BODY,
    ],
    [
      "..................",
      "..................",
      "......KKKKKK......",
      "..KKKKccccccKKKK..",
      ".KccccccccccccccK.",
      "..KKKKccccccKKKK..",
      "....KbbbbbbbbKt...",
      "...KbbbbbbbbbbKt..",
      "..KbgggbbbbgggbK..",
      "..KbgggbbbbgggbK..",
      ...SCHOLAR_BODY,
    ],
  ],
};

const CLOCK_BODY = [
  "..KgWWWWWWWWWWgK..",
  "...KggWWWWWWggK...",
  "....KKggggggKK....",
  "......KKGGKK......",
  "....KKggggggKK....",
  "...KggggggggggK...",
  "..KgKggrrrrggKgK..",
  "..KgKggrrrrggKgK..",
  "..KgKggggggggKgK..",
  "..KKKggggggggKKK..",
  "....KggggggggK....",
  "....KGGGGGGGGK....",
  "....KGGK..KGGK....",
  "....KGGK..KGGK....",
  "...KkkkK..KkkkK...",
  "..................",
];

/** Clockwork caretaker — the clock hands on its face tick between frames. */
export const timekeeper: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    g: "#d9a441",
    G: "#a87a2a",
    W: "#fff8e6",
    k: "#241a16",
    r: "#d05050",
  },
  frames: [
    [
      "......KKKKKK......",
      "....KKggggggKK....",
      "...KggWWWWWWggK...",
      "..KgWWWWWkWWWWgK..",
      "..KgWWWWWkWWWWgK..",
      "..KgWWWWWkkkWWgK..",
      ...CLOCK_BODY,
    ],
    [
      "......KKKKKK......",
      "....KKggggggKK....",
      "...KggWWWWWWggK...",
      "..KgWWWWWkWWWWgK..",
      "..KgWWWWWkWWWWgK..",
      "..KgWWkkkkWWWWgK..",
      ...CLOCK_BODY,
    ],
  ],
};

export const stargazer: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    c: "#7a5fd0",
    C: "#9a7ff0",
    W: "#f6f6fa",
    k: "#241a16",
    p: "#f0a8bc",
    O: "#e0708a",
    Y: "#f5c542",
  },
  frames: [
    [
      "....K........K....",
      "....K........K....",
      "...KYK......KYK...",
      "...KKK......KKK...",
      ...CHAT_BODY,
    ],
    [
      "...K..........K...",
      "...K..........K...",
      "..KYK........KYK..",
      "..KKK........KKK..",
      ...CHAT_BODY,
    ],
  ],
};

/** Echo the DJ: a little retro robot in rose headphones, with a speaker for a chest. */
const DJ_BODY = (cone: string) => [
  "......KmmmmK......",
  "...KKKKKKKKKKKK...",
  "..KMMMMMMMMMMMMK..",
  ".KKMMMKssssKMMMKK.",
  `.KMMMKs${cone}${cone}${cone}${cone}sKMMMK.`,
  `.KMMMKs${cone}${cone}${cone}${cone}sKMMMK.`,
  ".KKMMMKssssKMMMKK.",
  "..KMMMMMMMMMMMMK..",
  "...KKKKKKKKKKKK...",
  "....KmmK..KmmK....",
  "...KkkkK..KkkkK...",
];

export const dj: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    Y: "#f5c542",
    y: "#a8863a",
    H: "#e0708a",
    h: "#b44f6c",
    M: "#c3cbe0",
    m: "#8a93ab",
    S: "#1f2a44",
    E: "#7ff0e8",
    s: "#2e2a3a",
    c: "#6b6f86",
    C: "#a3a7c0",
    k: "#241a16",
  },
  frames: [
    [
      ".........Y........",
      ".........K........",
      "...hHHHHHHHHHHh...",
      "..HhKKKKKKKKKKhH..",
      ".HHKMMMMMMMMMMKHH.",
      ".HHKMSSSSSSSSMKHH.",
      ".HHKMSEESSEESMKHH.",
      ".HHKMSEESSEESMKHH.",
      ".HHKMSSSSSSSSMKHH.",
      "...KMMMMMMMMMMK...",
      "....KKKKKKKKKK....",
      ...DJ_BODY("c"),
    ],
    [
      ".........y........",
      ".........K........",
      "...hHHHHHHHHHHh...",
      "..HhKKKKKKKKKKhH..",
      ".HHKMMMMMMMMMMKHH.",
      ".HHKMSSSSSSSSMKHH.",
      ".HHKMSEESSEESMKHH.",
      ".HHKMSSSSSSSSMKHH.",
      ".HHKMSSSSSSSSMKHH.",
      "...KMMMMMMMMMMK...",
      "....KKKKKKKKKK....",
      ...DJ_BODY("C"),
    ],
  ],
};

/** Tinker the Mechanic: a fox in blue overalls, brass goggles up on the forehead, a wrench in hand. */
const TINKER_HEAD = (eyes: string) => [
  "...K..........K...",
  "..KFK........KFK..",
  "..KFFK......KFFK..",
  "..KFFFKKKKKKFFFK..",
  ".KFFFFFFFFFFFFFFK.",
  ".KFGgGFFFFFFGgGFK.",
  ".KFGGGFFFFFFGGGFK.",
  ".KFFFFFFFFFFFFFFK.",
  eyes,
  "..KFFFWWWWWWFFFK..",
  "..KfFWWWNNWWWFfK..",
  "...KfWWWWWWWWfK...",
  "....KKKKKKKKKK....",
  "...KBBBBBBBBBBK...",
  "..KFBbBBBBBBbBFK..",
];

export const mechanic: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    F: "#e8894a",
    f: "#b8612e",
    W: "#fff6e6",
    k: "#241a16",
    N: "#3b2a3a",
    G: "#d9a441",
    g: "#8fd0f0",
    B: "#3f6fb0",
    b: "#2c4f86",
    S: "#c9cbd6",
  },
  frames: [
    [
      ...TINKER_HEAD(".KFFkFFFFFFFFkFFK."),
      "..KFBBBGGBBBBBFKS.",
      "..KFBBBBBBBBBBFKSS",
      "...KBBBBBBBBBBK.S.",
      "...KBBBBBBBBBBK...",
      "....KbbK..KbbK....",
      "....KbbK..KbbK....",
      "...KkkkK..KkkkK...",
    ],
    [
      ...TINKER_HEAD(".KFFFFFFFFFFFFFFK."),
      "..KFBBBGGBBBBBFK.S",
      "..KFBBBBBBBBBBFKSS",
      "...KBBBBBBBBBBK...",
      "...KBBBBBBBBBBK...",
      "....KbbK..KbbK....",
      "....KbbK..KbbK....",
      "...KkkkK..KkkkK...",
    ],
  ],
};

// ------------------------------------------------------------------ scenery

export const rocket: PixelSprite = {
  palette: {
    K: "#3b2a3a",
    W: "#e9e9f2",
    S: "#b9bcce",
    O: "#e0708a",
    V: "#1c2748",
    G: "#767888",
  },
  frames: [
    [
      ".........KK.........",
      "........KWWK........",
      ".......KWWWWK.......",
      "......KWWWWWWK......",
      "......KWSSSSWK......",
      ".....KWWOOOOWWK.....",
      ".....KWWWWWWWWK.....",
      ".....KWWVVVVWWK.....",
      ".....KWVVVVVVWK.....",
      ".....KWVVVVVVWK.....",
      ".....KWWVVVVWWK.....",
      ".....KWWWWWWWWK.....",
      ".....KWWWWWWWWK.....",
      ".....KWWOOOOWWK.....",
      ".....KWWWWWWWWK.....",
      ".....KWWWWWWWWK.....",
      "....KOWWWWWWWWOK....",
      "...KOOWWWWWWWWOOK...",
      "..KOOOWWWWWWWWOOOK..",
      "..KOO.KWWWWWWK.OOK..",
      "..KO..KWSSSSWK..OK..",
      "..K...KGGGGGGK...K..",
      ".......KGGGGK.......",
    ],
  ],
};
