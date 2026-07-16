import { readFileSync } from 'fs';

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import copy from 'rollup-plugin-copy';
import scss from 'rollup-plugin-scss';
import { string } from 'rollup-plugin-string';
import sass from 'sass';

function htmlPlugin() {
    return {
        name: 'html',
        buildStart() {
            this.addWatchFile('src/index.html');
        },
        generateBundle() {
            const contents = readFileSync('src/index.html', 'utf-8');
            const transformed = contents.replace('<base href="">', `<base href="${process.env.BASE_HREF ?? ''}">`);
            this.emitFile({
                type: 'asset',
                fileName: 'index.html',
                source: transformed
            });
        }
    };
}

const buildCss = {
    input: 'src/index.scss',
    output: {
        dir: 'public'
    },
    plugins: [
        scss({
            exclude: ['static/**/*'],
            fileName: 'index.css',
            sourceMap: true,
            runtime: sass,
            processor: (css) => {
                return postcss([autoprefixer])
                .process(css, { from: undefined })
                .then(result => result.css);
            }
        }),
        {
            name: 'suppress-empty-chunks',
            generateBundle(options, bundle) {
                for (const [fileName, chunk] of Object.entries(bundle)) {
                    if (chunk.type === 'chunk' && chunk.code.trim() === '') {
                        delete bundle[fileName];
                    }
                }
            }
        }
    ]
};

const buildPublic = {
    input: 'src/index.ts',
    output: {
        dir: 'public',
        format: 'esm',
        sourcemap: true
    },
    plugins: [
        resolve(),
        commonjs(),   // Howler (and any CJS dep) → ES so named imports resolve
        typescript(),
        json(),
        htmlPlugin(),
        // Self-hosted Montserrat (latin subset): no render-blocking Google
        // request, no GDPR exposure (fonts.googleapis.com leaks visitor IPs —
        // LG München territory for a German real-estate product).
        copy({
            targets: [
                { src: 'src/fonts/*.woff2', dest: 'public/fonts' },
                // Standalone concierge chat page (phones navigate here; a plain
                // document is the one shape the iOS keyboard can't break).
                { src: 'src/chat.html', dest: 'public' },
                // MapLibre stylesheet for the surroundings map — injected as a
                // <link> by surroundings.ts on first open, alongside the
                // dynamically imported library (neither ships in the core bundle).
                { src: 'node_modules/maplibre-gl/dist/maplibre-gl.css', dest: 'public/vendor' }
            ]
        }),
        // The visitor bundle ships the full PlayCanvas engine — unminified it
        // was 3.0 MB (~680 KB gzip). Terser roughly halves the gzip size and,
        // more importantly on mobile, the parse time.
        terser()
    ]
};

const buildDist = {
    input: 'src/module/index.ts',
    output: {
        file: 'dist/index.js',
        format: 'esm',
        sourcemap: true
    },
    plugins: [
        string({
            include: ['**/*.html', '**/*.css', '**/*.js']
        }),
        typescript({ noEmit: true }),
        json(),
        copy({
            targets: [
                { src: 'src/module/index.d.ts', dest: 'dist' },
                { src: 'src/module/settings.d.ts', dest: 'dist' }
            ]
        })
    ]
};

const buildSettings = {
    input: 'src/settings.ts',
    output: {
        file: 'dist/settings.js',
        format: 'esm',
        sourcemap: true
    },
    plugins: [
        typescript({ noEmit: true })
    ]
};

export default [
    buildCss,
    buildPublic,
    buildDist,
    buildSettings
];
