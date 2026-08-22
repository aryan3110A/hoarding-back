import axios from 'axios';

const API_URL = 'http://localhost:3002/api/auth';

async function testAuth() {
    try {
        console.log('1. Testing Login with Admin credentials...');
        const loginResponse = await axios.post(`${API_URL}/login`, {
            email: 'admin@hoarding.local',
            password: 'Admin@123',
            deviceId: 'test-device-id',
            deviceName: 'Test Script'
        });

        console.log('✅ Login Successful!');
        console.log('Access Token:', loginResponse.data.data.accessToken ? 'Present' : 'Missing');
        console.log('Refresh Token:', loginResponse.data.data.refreshToken ? 'Present' : 'Missing');
        console.log('User:', loginResponse.data.data.user);

        const { accessToken, refreshToken } = loginResponse.data.data;

        console.log('\n2. Testing Protected Route (List Hoardings) with Access Token...');
        try {
            const hoardingsResponse = await axios.get('http://localhost:3002/api/hoardings', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            console.log('✅ Protected Route Access Successful!');
            console.log('Full Response Data:', JSON.stringify(hoardingsResponse.data, null, 2));
            console.log('Hoardings Count:', hoardingsResponse.data.data?.length);
        } catch (error: any) {
            console.error('❌ Protected Route Failed:', error.response?.data || error.message);
        }

        console.log('\n3. Testing Refresh Token...');
        try {
            const refreshResponse = await axios.post(`${API_URL}/refresh`, {
                refreshToken: refreshToken
            });
            console.log('✅ Refresh Token Successful!');
            console.log('New Access Token:', refreshResponse.data.data.accessToken ? 'Present' : 'Missing');
        } catch (error: any) {
            console.error('❌ Refresh Token Failed:', error.response?.data || error.message);
        }

        console.log('\n4. Testing Logout...');
        try {
            await axios.post(`${API_URL}/logout`, {
                refreshToken: refreshToken
            });
            console.log('✅ Logout Successful!');
        } catch (error: any) {
            console.error('❌ Logout Failed:', error.response?.data || error.message);
        }

    } catch (error: any) {
        console.error('❌ Login Failed:', error.response?.data || error.message);
    }
}

testAuth();
