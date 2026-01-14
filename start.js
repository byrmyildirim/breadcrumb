// start.js - Database-aware startup script
const { execSync, spawn } = require('child_process');

const MAX_RETRIES = 15;
const RETRY_INTERVAL = 5000; // 5 seconds

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryDbPush() {
    try {
        console.log('Attempting prisma db push...');
        execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
        return true;
    } catch (error) {
        return false;
    }
}

async function main() {
    console.log('Starting application with database retry logic...');
    console.log(`Will retry up to ${MAX_RETRIES} times with ${RETRY_INTERVAL / 1000}s interval`);

    for (let i = 1; i <= MAX_RETRIES; i++) {
        console.log(`\nAttempt ${i}/${MAX_RETRIES}...`);

        const success = await tryDbPush();

        if (success) {
            console.log('\n✓ Database is ready! Starting the application...\n');

            // Start the application
            const app = spawn('npm', ['run', 'start'], {
                stdio: 'inherit',
                shell: true
            });

            app.on('close', (code) => {
                process.exit(code);
            });

            return;
        }

        if (i < MAX_RETRIES) {
            console.log(`Waiting ${RETRY_INTERVAL / 1000} seconds before next attempt...`);
            await sleep(RETRY_INTERVAL);
        }
    }

    console.error(`\n✗ Failed to connect to database after ${MAX_RETRIES} attempts`);
    process.exit(1);
}

main();
