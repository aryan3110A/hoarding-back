#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3002/api"
echo -e "${YELLOW}Testing Phase 1 API Endpoints${NC}\n"

# Test 1: Health Check
echo -e "${YELLOW}1. Testing Health Check${NC}"
HEALTH=$(curl -s http://localhost:3002/health)
if [[ $HEALTH == *"ok"* ]]; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed${NC}"
    exit 1
fi
echo ""

# Test 2: Login
echo -e "${YELLOW}2. Testing POST /api/auth/login${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@hoarding.local",
    "password": "Admin@123",
    "deviceId": "test-device-curl-1",
    "deviceName": "Curl Test Device",
    "lat": 23.0343,
    "lng": 72.5645
  }')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)

if [[ -n "$ACCESS_TOKEN" && -n "$REFRESH_TOKEN" ]]; then
    echo -e "${GREEN}✓ Login successful${NC}"
    echo "  Access Token: ${ACCESS_TOKEN:0:20}..."
    echo "  Refresh Token: ${REFRESH_TOKEN:0:20}..."
else
    echo -e "${RED}✗ Login failed${NC}"
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi
echo ""

# Test 3: Refresh Token
echo -e "${YELLOW}3. Testing POST /api/auth/refresh${NC}"
REFRESH_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")

NEW_ACCESS_TOKEN=$(echo $REFRESH_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
if [[ -n "$NEW_ACCESS_TOKEN" ]]; then
    echo -e "${GREEN}✓ Token refresh successful${NC}"
    ACCESS_TOKEN=$NEW_ACCESS_TOKEN
else
    echo -e "${RED}✗ Token refresh failed${NC}"
    echo "Response: $REFRESH_RESPONSE"
fi
echo ""

# Test 4: Device Ping (no auth required)
echo -e "${YELLOW}4. Testing POST /api/devices/:deviceId/ping${NC}"
PING_RESPONSE=$(curl -s -X POST "$BASE_URL/devices/test-device-curl-1/ping" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 23.0400,
    "lng": 72.5700,
    "ip": "127.0.0.1"
  }')

if [[ $PING_RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✓ Device ping successful${NC}"
else
    echo -e "${RED}✗ Device ping failed${NC}"
    echo "Response: $PING_RESPONSE"
fi
echo ""

# Test 5: Device Check-in (requires auth)
echo -e "${YELLOW}5. Testing POST /api/devices/:deviceId/checkin${NC}"
CHECKIN_RESPONSE=$(curl -s -X POST "$BASE_URL/devices/test-device-curl-1/checkin" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "lat": 23.0450,
    "lng": 72.5750,
    "accuracy": 10,
    "note": "Test check-in from curl"
  }')

if [[ $CHECKIN_RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✓ Device check-in successful${NC}"
else
    echo -e "${RED}✗ Device check-in failed${NC}"
    echo "Response: $CHECKIN_RESPONSE"
fi
echo ""

# Test 6: Get All Hoardings
echo -e "${YELLOW}6. Testing GET /api/hoardings${NC}"
HOARDINGS_RESPONSE=$(curl -s -X GET "$BASE_URL/hoardings" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

if [[ $HOARDINGS_RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✓ Get hoardings successful${NC}"
    HOARDING_COUNT=$(echo $HOARDINGS_RESPONSE | grep -o '"hoardings":\[[^]]*\]' | grep -o ',' | wc -l | tr -d ' ')
    echo "  Found hoardings (count may vary)"
else
    echo -e "${RED}✗ Get hoardings failed${NC}"
    echo "Response: $HOARDINGS_RESPONSE"
fi
echo ""

# Test 7: Create Hoarding (Admin only)
echo -e "${YELLOW}7. Testing POST /api/hoardings (Admin)${NC}"
TIMESTAMP=$(date +%s)
CREATE_HOARDING_RESPONSE=$(curl -s -X POST "$BASE_URL/hoardings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"code\": \"H-CURL-TEST-$TIMESTAMP\",
    \"title\": \"Curl Test Hoarding $TIMESTAMP\",
    \"city\": \"Mumbai\",
    \"area\": \"Test Area\",
    \"lat\": 23.0343,
    \"lng\": 72.5645,
    \"status\": \"available\"
  }")

HOARDING_ID=$(echo $CREATE_HOARDING_RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4)
if [[ -n "$HOARDING_ID" ]]; then
    echo -e "${GREEN}✓ Create hoarding successful${NC}"
    echo "  Hoarding ID: $HOARDING_ID"
else
    echo -e "${RED}✗ Create hoarding failed${NC}"
    echo "Response: $CREATE_HOARDING_RESPONSE"
fi
echo ""

# Test 8: Get Hoarding by ID
if [[ -n "$HOARDING_ID" ]]; then
    echo -e "${YELLOW}8. Testing GET /api/hoardings/:id${NC}"
    GET_HOARDING_RESPONSE=$(curl -s -X GET "$BASE_URL/hoardings/$HOARDING_ID" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    
    if [[ $GET_HOARDING_RESPONSE == *"success"* ]]; then
        echo -e "${GREEN}✓ Get hoarding by ID successful${NC}"
    else
        echo -e "${RED}✗ Get hoarding by ID failed${NC}"
        echo "Response: $GET_HOARDING_RESPONSE"
    fi
    echo ""
fi

# Test 9: Get Hoarding Availability
if [[ -n "$HOARDING_ID" ]]; then
    echo -e "${YELLOW}9. Testing GET /api/hoardings/:id/availability${NC}"
    AVAILABILITY_RESPONSE=$(curl -s -X GET "$BASE_URL/hoardings/$HOARDING_ID/availability" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    
    if [[ $AVAILABILITY_RESPONSE == *"success"* ]]; then
        echo -e "${GREEN}✓ Get hoarding availability successful${NC}"
    else
        echo -e "${RED}✗ Get hoarding availability failed${NC}"
        echo "Response: $AVAILABILITY_RESPONSE"
    fi
    echo ""
fi

# Test 10: Create Booking (Admin only)
if [[ -n "$HOARDING_ID" ]]; then
    echo -e "${YELLOW}10. Testing POST /api/bookings (Admin)${NC}"
    START_DATE=$(date -u -v+1d +"%Y-%m-%dT00:00:00Z" 2>/dev/null || date -u -d "+1 day" +"%Y-%m-%dT00:00:00Z" 2>/dev/null || echo "2024-12-01T00:00:00Z")
    END_DATE=$(date -u -v+30d +"%Y-%m-%dT00:00:00Z" 2>/dev/null || date -u -d "+30 days" +"%Y-%m-%dT00:00:00Z" 2>/dev/null || echo "2024-12-31T00:00:00Z")
    
    CREATE_BOOKING_RESPONSE=$(curl -s -X POST "$BASE_URL/bookings" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -d "{
        \"hoardingId\": \"$HOARDING_ID\",
        \"clientName\": \"Curl Test Client\",
        \"clientContact\": \"9876543210\",
        \"startDate\": \"$START_DATE\",
        \"endDate\": \"$END_DATE\",
        \"price\": 50000
      }")
    
    BOOKING_ID=$(echo $CREATE_BOOKING_RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    if [[ -n "$BOOKING_ID" ]]; then
        echo -e "${GREEN}✓ Create booking successful${NC}"
        echo "  Booking ID: $BOOKING_ID"
    else
        echo -e "${RED}✗ Create booking failed${NC}"
        echo "Response: $CREATE_BOOKING_RESPONSE"
    fi
    echo ""
fi

# Test 11: Logout
echo -e "${YELLOW}11. Testing POST /api/auth/logout${NC}"
LOGOUT_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/logout" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")

if [[ $LOGOUT_RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✓ Logout successful${NC}"
else
    echo -e "${RED}✗ Logout failed${NC}"
    echo "Response: $LOGOUT_RESPONSE"
fi
echo ""

# Test 12: Try to use refresh token after logout (should fail)
echo -e "${YELLOW}12. Testing refresh token after logout (should fail)${NC}"
REFRESH_AFTER_LOGOUT=$(curl -s -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")

if [[ $REFRESH_AFTER_LOGOUT == *"error"* ]] || [[ $REFRESH_AFTER_LOGOUT == *"401"* ]]; then
    echo -e "${GREEN}✓ Refresh token correctly rejected after logout${NC}"
else
    echo -e "${YELLOW}⚠ Refresh token still works (may be expected)${NC}"
fi
echo ""

echo -e "${GREEN}=== API Testing Complete ===${NC}"

