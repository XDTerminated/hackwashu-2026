// The colony's theme song, written out so it's easy to change.
// music.ts plays it as 8-bit swing: the melody on a pulse-wave lead, a walking
// bass and chord stabs from the chord at the start of each bar, and brushes.
//
// One bar per line:   CHORD | NOTE:BEATS NOTE:BEATS ...
//   - chords: C, Cm, C7, Cmaj7, Cm7, C6, Cm6, Cm7b5, Cdim7 (sharps/flats: F#m7, Bb7)
//   - notes: a name and octave (C4 is middle C; E5, F#5, Bb4), or r for a rest
//   - beats: 1 = a quarter note, .5 = an eighth, 2 = a half; each bar adds up to 4
// Lines starting with # are comments; "bpm 120" sets the tempo.
// The tune plays through, then the lead improvises a chorus over the same
// chords, then the tune again.

export const TUNE = `
# Moonlight Swing: opens with a nod to the "Fly me to the moon" hook (bars 1 and 9),
# over circle-of-fifths changes; the rest of the melody is our own.
bpm 120
Am7   | C6:1.5 B5:.5 A5:.5 G5:.5 F5:1
Dm7   | F5:1 r:.5 A5:.5 C6:.5 D6:.5 C6:1
G7    | B5:1.5 A5:.5 G5:.5 F5:.5 D5:1
Cmaj7 | E5:2 r:1 G5:.5 E5:.5
Fmaj7 | A5:1 C6:.5 E6:.5 D6:1 C6:1
Bm7b5 | B5:1 A5:.5 F5:.5 D5:1.5 r:.5
E7    | G#5:1 B5:.5 D6:.5 C6:1 B5:1
Am7   | A5:3 r:1
Am7   | C6:1.5 B5:.5 A5:.5 G5:.5 F5:1
Dm7   | D5:.5 F5:.5 A5:.5 C6:1.5 A5:1
G7    | G5:1 B5:.5 D6:.5 F6:1 D6:1
Cmaj7 | E6:1.5 D6:.5 C6:.5 B5:.5 G5:1
Fmaj7 | A5:1 F5:.5 A5:.5 C6:1 A5:1
Bm7b5 | D6:1 C6:.5 A5:.5 F5:1 D5:1
E7    | E5:.5 G#5:.5 B5:.5 D6:1.5 B5:1
Am7   | A5:2 r:.5 E5:.5 G5:.5 B5:.5
`;
