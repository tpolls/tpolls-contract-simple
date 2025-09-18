const { runTolkCompiler } = require('@ton/tolk-js');
const fs = require('fs');
const path = require('path');

async function buildTolkContract() {
  console.log('🔨 Building Tolk Contracts...\n');

  try {
    // Ensure build directory exists
    const buildDir = path.join(__dirname, '../build');
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }

    // Build main Tolk contract
    console.log('📋 Building main.tolk...');

    const tolkSourcePath = path.join(__dirname, '../contracts/main.tolk');
    const outputPath = path.join(buildDir, 'main.json');

    // Read the Tolk source code
    const tolkSource = fs.readFileSync(tolkSourcePath, 'utf8');

    // Compile with Tolk
    const result = await runTolkCompiler({
      entrypointFileName: 'main.tolk',
      fsReadCallback: (path) => {
        // Handle reading of the main contract file
        if (path === 'main.tolk') {
          return tolkSource;
        }
        // For any other files, check if they exist in contracts directory
        const fullPath = path.join(__dirname, '../contracts', path);
        if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath, 'utf8');
        }
        throw new Error(`File not found: ${path}`);
      },
      optimizationLevel: 2,
      withStackComments: false,
      withSrcLineComments: false
    });

    // Write the compiled result
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    console.log('✅ Tolk compilation successful!');
    console.log(`📁 Output written to: ${outputPath}`);

    // Log compilation details
    if (result.status === 'ok') {
      console.log('\n📊 Compilation Results:');
      console.log(`✅ Status: ${result.status}`);
      if (result.fift) {
        console.log(`📄 FunC code generated successfully`);
      }
      if (result.hex) {
        console.log(`💾 Bytecode: ${result.hex.length} characters`);
      }
    } else {
      console.error('\n❌ Compilation failed:');
      console.error(result.stderr || result.message || 'Unknown error');
      process.exit(1);
    }

    // Create contract info file for deployment scripts
    const contractInfo = {
      name: 'TPollsDapp',
      source: 'main.tolk',
      compiled: true,
      timestamp: new Date().toISOString(),
      features: [
        'Poll Creation',
        'Voting System',
        'TON Rewards',
        'Jetton Rewards',
        'Vote Tracking',
        'Reward Claims'
      ],
      jettonSupport: true,
      tolkCompiled: true
    };

    fs.writeFileSync(
      path.join(buildDir, 'contract-info.json'),
      JSON.stringify(contractInfo, null, 2)
    );

    console.log('\n🎉 Build Complete!');
    console.log('📋 Contract Features:');
    contractInfo.features.forEach(feature => {
      console.log(`  ✅ ${feature}`);
    });
    console.log(`  💎 Jetton Support: ${contractInfo.jettonSupport ? 'Enabled' : 'Disabled'}`);

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    if (error.stderr) {
      console.error('Compiler Error:', error.stderr);
    }
    process.exit(1);
  }
}

// Run the build if this script is executed directly
if (require.main === module) {
  buildTolkContract().catch(console.error);
}

module.exports = { buildTolkContract };