import axios from 'axios';

async function run() {
  try {
    const base = 'http://localhost:3001/api';
    const login = await axios.post(base + '/auth/login', {
      email: 'owner@demo.com',
      password: 'Password@123',
      deviceId: 'dev-rent-test'
    });
    const token: string = login.data.data.accessToken;
    console.log('Login OK. Token length:', token.length);

    const hoardingId = '7832e2ac-1d22-49ad-a2a8-d84353a0280a';
    const payload = {
      partyType: 'Private',
      rentAmount: 12500,
      incrementYear: 2026,
      paymentMode: 'Monthly',
      lastPaymentDate: '2025-11-01'
    };

    const headers = { Authorization: 'Bearer ' + token };

    const save = await axios.post(base + '/hoardings/' + hoardingId + '/rent', payload, { headers });
    console.log('Save rent response:', JSON.stringify(save.data, null, 2));

    const get = await axios.get(base + '/hoardings/' + hoardingId + '/rent', { headers });
    console.log('Fetch rent response:', JSON.stringify(get.data, null, 2));
  } catch (e: any) {
    console.error('Test failed:', e.response?.data || e.message);
    if (e.response) {
      console.error('Status:', e.response.status);
    } else {
      console.error('Stack:', e.stack);
    }
  }
}

run();
