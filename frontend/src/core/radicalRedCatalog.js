import data from './radicalRed41Data.json' with { type: 'json' };

// A JavaScript module keeps lazy loading compatible with Vite's transformed
// JSON responses in development and Node's JSON import attributes in tests.
export default data;
