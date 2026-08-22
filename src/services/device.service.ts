import { UserDeviceRepository } from '../repositories/userDevice.repository';
import { LocationRepository } from '../repositories/location.repository';

const userDeviceRepository = new UserDeviceRepository();
const locationRepository = new LocationRepository();

interface PingData {
  lat?: number;
  lng?: number;
  ip?: string;
}

interface CheckinData {
  lat: number;
  lng: number;
  accuracy?: number;
  note?: string;
  ip?: string;
}

export class DeviceService {
  async ping(userId: string, deviceId: string, data: PingData) {
    const device = await userDeviceRepository.findByUserAndDeviceId(userId, deviceId);
    if (!device) {
      // Device not found - this is acceptable for ping (device might not be registered yet)
      return;
    }

    await userDeviceRepository.upsert(userId, deviceId, {
      lastLat: data.lat,
      lastLng: data.lng,
      lastIp: data.ip,
    });

    // Create LocationLog(type='ping')
    // In a real app, we would throttle this (e.g., only log if moved > 100m or > 5 mins)
    // For now, we log every ping as per basic spec requirement, or we can add a simple check.
    if (data.lat != null && data.lng != null) {
      await locationRepository.create({
        userId,
        deviceId,
        type: 'ping',
        lat: data.lat,
        lng: data.lng,
        ip: data.ip,
      });
    }
  }

  async checkin(deviceId: string, userId: string, data: CheckinData) {
    await locationRepository.create({
      userId,
      deviceId,
      type: 'checkin',
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      note: data.note,
      ip: data.ip,
    });
  }
}
