import { DeviceService } from '../../../src/services/device.service';
import { UserDeviceRepository } from '../../../src/repositories/userDevice.repository';
import { LocationRepository } from '../../../src/repositories/location.repository';

// Define mocks with shared state inside the factory
jest.mock('../../../src/repositories/userDevice.repository', () => {
  const mockRepo = {
    findByUserAndDeviceId: jest.fn(),
    upsert: jest.fn(),
  };
  return {
    UserDeviceRepository: jest.fn(() => mockRepo),
  };
});

jest.mock('../../../src/repositories/location.repository', () => {
  const mockRepo = {
    create: jest.fn(),
  };
  return {
    LocationRepository: jest.fn(() => mockRepo),
  };
});

describe('DeviceService (unit)', () => {
  let deviceService: DeviceService;
  let userDeviceRepo: any;
  let locationRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService = new DeviceService();

    // Get the shared mock instances by instantiating the mocked classes
    userDeviceRepo = new UserDeviceRepository() as any;
    locationRepo = new LocationRepository() as any;
  });

  describe('ping', () => {
    const userId = 'user-123';
    const deviceId = 'device-456';
    const pingData = {
      lat: 23.0343,
      lng: 72.5645,
      accuracy: 10,
      ip: '127.0.0.1',
    };

    it('should update device lastSeen when device exists', async () => {
      const existingDevice = {
        id: 'device-record-1',
        userId,
        deviceId,
        lastSeen: new Date('2024-01-01'),
      };

      userDeviceRepo.findByUserAndDeviceId.mockResolvedValue(existingDevice);
      userDeviceRepo.upsert.mockResolvedValue({
        ...existingDevice,
        lastSeen: new Date(),
        lastLat: pingData.lat,
        lastLng: pingData.lng,
      });

      await deviceService.ping(userId, deviceId, pingData);

      expect(userDeviceRepo.upsert).toHaveBeenCalledWith(
        userId,
        deviceId,
        expect.objectContaining({
          lastLat: pingData.lat,
          lastLng: pingData.lng,
          lastIp: pingData.ip,
        }),
      );
    });

    it('should handle ping when device does not exist gracefully', async () => {
      userDeviceRepo.findByUserAndDeviceId.mockResolvedValue(null);

      await deviceService.ping(userId, deviceId, pingData);

      // Should not throw, just return early
      expect(userDeviceRepo.upsert).not.toHaveBeenCalled();
      // Explicitly check that no creation (upsert) happened
      expect(userDeviceRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('checkin', () => {
    const userId = 'user-123';
    const deviceId = 'device-456';
    const checkinData = {
      lat: 23.0343,
      lng: 72.5645,
      accuracy: 10,
      note: 'Client visit',
      ip: '127.0.0.1',
    };

    it('should create location log entry', async () => {
      locationRepo.create.mockResolvedValue({
        id: 'location-123',
        userId,
        deviceId,
        type: 'checkin',
        ...checkinData,
      });

      await deviceService.checkin(deviceId, userId, checkinData);

      expect(locationRepo.create).toHaveBeenCalledWith({
        userId,
        deviceId,
        type: 'checkin',
        lat: checkinData.lat,
        lng: checkinData.lng,
        accuracy: checkinData.accuracy,
        note: checkinData.note,
        ip: checkinData.ip,
      });
    });
  });
});
