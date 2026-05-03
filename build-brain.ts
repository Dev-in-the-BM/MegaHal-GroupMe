import { MegaHAL } from './src/megahal/megahal';
import fs from 'fs';

async function build() {
    console.log("🧠 Creating MegaHAL instance...");
    const hal = new MegaHAL();
    
    console.log("📚 Training 'default' personality (this might take a second)...");
    await hal.become('default');
    
    console.log("💾 Saving brain to binary format...");
    const brainData = hal.save();
    
    if (brainData) {
        fs.writeFileSync('default-brain.bin', brainData);
        console.log("✅ Success! Brain saved to default-brain.bin");
    } else {
        console.error("❌ Failed to save brain data.");
    }
}

build();