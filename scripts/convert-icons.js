const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Define the icon paths for all projects
const iconConfigs = [
    {
        name: 'ACCM',
        svgPath: path.join(__dirname, '..', 'resources', 'icon.svg'),
        pngPath: path.join(__dirname, '..', 'resources', 'icon.png')
    },
    {
        name: 'AACCA',
        svgPath: path.join(__dirname, '..', '..', 'Acidni-Chat-Cost-Analyzer', 'resources', 'icon.svg'),
        pngPath: path.join(__dirname, '..', '..', 'Acidni-Chat-Cost-Analyzer', 'resources', 'icon.png')
    },
    {
        name: 'AACC',
        svgPath: path.join(__dirname, '..', '..', 'Acidni-AI-Chat-Chooser', 'resources', 'icon.svg'),
        pngPath: path.join(__dirname, '..', '..', 'Acidni-AI-Chat-Chooser', 'resources', 'icon.png')
    },
    {
        name: 'AACE',
        svgPath: path.join(__dirname, '..', '..', 'Acidni-AI-Chat-Expert', 'resources', 'icon.svg'),
        pngPath: path.join(__dirname, '..', '..', 'Acidni-AI-Chat-Expert', 'resources', 'icon.png')
    },
    {
        name: 'AACE-mono',
        svgPath: path.join(__dirname, '..', '..', 'Acidni-AI-Chat-Expert', 'resources', 'icon-mono.svg'),
        pngPath: path.join(__dirname, '..', '..', 'Acidni-AI-Chat-Expert', 'resources', 'icon-mono.png')
    }
];

async function convertSvgToPng(config) {
    try {
        // Check if SVG exists
        if (!fs.existsSync(config.svgPath)) {
            console.log(`⚠️  ${config.name}: SVG not found at ${config.svgPath}`);
            return false;
        }

        // Read the SVG file
        const svgBuffer = fs.readFileSync(config.svgPath);

        // Convert to PNG at 128x128 (VS Code recommended size)
        await sharp(svgBuffer)
            .resize(128, 128)
            .png()
            .toFile(config.pngPath);

        console.log(`✅ ${config.name}: Converted ${config.svgPath} → ${config.pngPath}`);
        return true;
    } catch (error) {
        console.error(`❌ ${config.name}: Error converting icon - ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🎨 Converting SVG icons to PNG...\n');
    
    let success = 0;
    let failed = 0;
    
    for (const config of iconConfigs) {
        const result = await convertSvgToPng(config);
        if (result) {
            success++;
        } else {
            failed++;
        }
    }
    
    console.log(`\n📊 Results: ${success} converted, ${failed} skipped/failed`);
}

main();
