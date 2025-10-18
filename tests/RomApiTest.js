const { RommApi } = require('../out/api/RommApi');

// load environment variables from .env file
require('dotenv').config();


const BASE_URL = process.env.ROMM_URL && process.env.ROMM_URL.trim() && process.env.ROMM_URL.endsWith('/')
    ? process.env.ROMM_URL.trim().slice(0, -1)
    : process.env.ROMM_URL && process.env.ROMM_URL.trim()
        ? process.env.ROMM_URL.trim()
        : 'http://localhost:8080';

async function testRommApi() {
    console.log('🚀 Testing RommApi class...\n');

    try {
        // Test 1: Initialize without authentication
        console.log('Test 1: Initializing RommApi without auth...');
        const api = new RommApi(BASE_URL);


        // Test 2: Check base URL
        const baseUrl = api.getBaseUrl();
        console.log(`✅ Base URL: ${baseUrl}\n`);

        // check if the baseUrl is correct by fetching heartbeat
        console.log('Test 2: Testing connection to RomM server...');
        const heartbeat = await api.testConnection();
        console.log(`Heartbeat response: ${JSON.stringify(heartbeat)}\n`);
        if (heartbeat && heartbeat.success === true) console.log(`✅ Heartbeat test passed, RomM running version ${heartbeat.data.SYSTEM.VERSION}.\n`);
        else throw new Error('❌ Heartbeat test failed.');



        // test login
        console.log('Test 3: Testing login with provided credentials...');
        const username = process.env.ROMM_USERNAME || 'admin';
        const password = process.env.ROMM_PASSWORD || 'admin';
        const loginResponse = await api.loginWithCredentials(username, password);
        const connectionState = await api.isUserAuthenticated();
        console.log(`Connection state after login: ${JSON.stringify(connectionState)}\n`);
        if (loginResponse && loginResponse.success === true) {
            console.log('✅ Login successful.\n');
        } else {
            throw new Error('❌ Login failed.');
        }


    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

// Run the test
testRommApi();
