import { describe, it, expect, vi } from 'vitest';
import { UserService } from '@/app/api/state-sync/services/userService';
import { NotificationService } from '@/app/api/state-sync/services/notificationService';

describe('SOLID Dependency Injection', () => {
  it('should support dependency injection for UserService', async () => {
    const mockPrisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'mock-id', email: 'mock@example.com' }]),
      },
    };

    // Inject mockPrisma dependency
    const service = new UserService(mockPrisma as any);
    const result = await service.handle(
      'user:getUser',
      { email: 'mock@example.com' },
      'mock@example.com',
      '127.0.0.1'
    );

    expect(result).toEqual([{ id: 'mock-id', email: 'mock@example.com' }]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { email: 'mock@example.com' },
    });
  });

  it('should support dependency injection for NotificationService', async () => {
    const mockPrisma = {
      notification: {
        findMany: vi.fn().mockResolvedValue([{ id: 'notif-1', title: 'Test' }]),
      },
    };

    // Inject mockPrisma dependency
    const service = new NotificationService(mockPrisma as any);
    const result = await service.handle(
      'notifications:getNotifications',
      { userEmail: 'mock@example.com' },
      'mock@example.com',
      '127.0.0.1'
    );

    expect(result).toEqual([{ id: 'notif-1', title: 'Test' }]);
    expect(mockPrisma.notification.findMany).toHaveBeenCalled();
  });
});
