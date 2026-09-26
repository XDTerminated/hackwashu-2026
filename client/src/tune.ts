// The colony's theme song, written out so it's easy to change.
// music.ts plays it as 8-bit swing: the melody on a pulse-wave lead, a walking
// bass and chord stabs from the chord at the start of each bar, and brushes.
//
// One bar per line:   CHORD | NOTE:BEATS NOTE:BEATS ...
//   - chords: C, Cm, C7, Cmaj7, Cm7, C6, Cm6, Cm7b5, Cdim7 (sharps/flats: F#m7, Bb7)
//   - notes: a name and octave (C4 is middle C; E5, F#5, Bb4), or r for a rest
//   - beats: 1 = a quarter note, .5 = an eighth, 2 = a half; each bar adds up to 4
// Lines starting with # are comments; "bpm 116" sets the tempo.
// The tune plays through, then the lead improvises a chorus over the same
// chords, then the tune again.

export const TUNE = `
# Moonlight Swing: a nod to "Fly me to the moon, let me play among the stars" (bars 1-4,
# and again in bars 9-12) over circle-of-fifths changes; the rest of the melody is our own.
bpm 120
Am7   | C5:1.5 B4:.5 A4:1 G4:1
Dm7   | F4:1.5 G4:.5 A4:1 C5:1
G7    | B4:1.5 A4:.5 G4:1 F4:1
Cmaj7 | E4:2.5 r:.5 G4:.5 E4:.5
Fmaj7 | A4:1 C5:.5 E5:.5 D5:1 C5:1
Bm7b5 | B4:1 A4:.5 F4:.5 D4:1.5 r:.5
E7    | G#4:1 B4:.5 D5:.5 C5:1 B4:1
Am7   | A4:3 r:1
Am7   | C5:1.5 B4:.5 A4:1 G4:1
Dm7   | F4:1.5 G4:.5 A4:1 C5:1
G7    | B4:1.5 A4:.5 G4:1 F4:1
Cmaj7 | E4:3 r:1
Fmaj7 | A4:1 F4:.5 A4:.5 C5:1 A4:1
Bm7b5 | D5:1 C5:.5 A4:.5 F4:1 D4:1
E7    | E4:.5 G#4:.5 B4:.5 D5:1.5 B4:1
Am7   | A4:2 r:.5 E4:.5 G4:.5 B4:.5
`;
