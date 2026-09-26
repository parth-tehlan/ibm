// Alias so `npm test` also runs the committed surgeon binding before every file
// (belt-and-suspenders alongside jest.config.js's setupFiles).
require('./.bob/scratch/bind-seams.cjs');