import { defineConfig } from 'vite';

// GitHub Pages serves this from a subpath (e.g. username.github.io/EAR/),
// not the domain root — relative asset paths make the build work there
// without hardcoding the repo name.
export default defineConfig({
  base: './',
});
