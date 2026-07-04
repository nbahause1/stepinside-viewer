// Raw-bytes imports for the bundled reference furniture photos. wrangler's
// [[rules]] type="Data" (wrangler.toml) turns these files into ArrayBuffer
// module exports at deploy time; this declaration keeps tsc in agreement.
declare module '*.jpg' {
  const bytes: ArrayBuffer;
  export default bytes;
}
declare module '*.png' {
  const bytes: ArrayBuffer;
  export default bytes;
}
