/// <reference types="astro/client" />

declare module '*.PNG' {
  const image: import('astro').ImageMetadata;
  export default image;
}
