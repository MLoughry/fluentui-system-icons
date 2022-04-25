// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
// @ts-check

const fs = require("fs/promises");
const mkdirp = require('mkdirp');
const path = require("path");
const { promisify } = require('util');
const glob = promisify(require('glob'));
const process = require("process");
const argv = require("yargs").boolean("selector").default("selector", false).argv;
const _ = require("lodash");
const fantasticon = require('fantasticon');

const SRC_PATH = argv.source;
const DEST_PATH = argv.dest;
const ICON_TYPE = argv.iconType;
const CODEPOINTS_FILE = argv.codepoints;

if (!SRC_PATH) {
    throw new Error("SVG source folder not specified by --source");
}
if (!DEST_PATH) {
    throw new Error("Output destination folder not specified by --dest");
}
if (!(ICON_TYPE === 'Filled' || ICON_TYPE === 'Regular')) {
    throw new Error("Icon type not specified");
}

async function main() {
    await mkdirp(DEST_PATH);
    const stagingFolder = await mkdirp(path.resolve(DEST_PATH, ICON_TYPE));

    const svgFiles = await glob(path.resolve(SRC_PATH, `*_${ICON_TYPE.toLowerCase()}.svg`));
    const icons = new Set(svgFiles.map(file => path.basename(file).replace(/\.svg$/, '')));

    if (icons.size > 6400) {
        throw new Error('Too many icons to fit into the Unicode private use area (0xE000-0xF8FF). See https://unicode-table.com/en/blocks/private-use-area/')
    }
    
    // Copy all icons of the given icon type to the staging folder
    await Promise.all((svgFiles).map(
        async svgFile => fs.copyFile(svgFile, path.resolve(stagingFolder, path.basename(svgFile)))
    ));

    // Generate the font and associated assets
    await fantasticon.generateFonts({
        inputDir: stagingFolder,
        outputDir: path.resolve(DEST_PATH),
        name: `FluentSystemIcons-${ICON_TYPE}`,
        fontTypes: [fantasticon.ASSET_TYPES.TTF, fantasticon.ASSET_TYPES.SVG],
        assetTypes: [fantasticon.ASSET_TYPES.CSS, fantasticon.ASSET_TYPES.HTML, fantasticon.ASSET_TYPES.JSON],
        formatOptions: { json: { indent: 2 } },
        codepoints: await getCodepoints(icons),
        fontHeight: 500,
        normalize: true
    });
    
    // Clean up staging folder
    await Promise.all(svgFiles.map(
        async svgFile => fs.unlink(path.resolve(stagingFolder, path.basename(svgFile)))
    ));
    if ((await fs.readdir(stagingFolder)).length === 0) {
        await fs.rmdir(stagingFolder);
    }
}

/**
 * 
 * @param {Set<string>} icons - Set of icons being consumed into the font
 * @returns {Promise<Record<string, number>>}
 */
async function getCodepoints(icons) {
    if (!CODEPOINTS_FILE) {
        return {};
    } else {
        const originalCodepoints = JSON.parse(await fs.readFile(CODEPOINTS_FILE, 'utf8'));
        const codepoints = Object.fromEntries(
            Object.entries(originalCodepoints)
                .filter(([iconName]) => icons.has(iconName))
                .map(([iconName, stringCodepointHex]) => [iconName, Number.parseInt(stringCodepointHex, 16)])
        );

        // Fix any codepoints outside the private use area
        let nextCodePoint = 0xe000;
        let usedCodePoints = new Set(Object.values(codepoints));

        for (const [iconName, codepoint] of Object.entries(codepoints)) {
            if (codepoint < 0xe000 || codepoint > 0xf8ff) {
                // Find a new free codepoint
                while (usedCodePoints.has(nextCodePoint)) {
                    nextCodePoint++;
                }

                usedCodePoints.add(nextCodePoint);
                codepoints[iconName] = nextCodePoint;
            }
        }

        return codepoints;
    }
}

main();
