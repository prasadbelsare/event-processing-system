import { z } from 'zod';

export const PackageStatus = z.enum([
    'PICKED_UP',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FAILED_ATTEMPT',
]);
export type PackageStatus = z.infer<typeof PackageStatus>;

const base = {
    eventId: z.string().uuid(),
    packageId: z.string().min(1),
    occurredAt: z.string().datetime(),
};

export const PackageScanned = z.object({
    ...base,
    eventType: z.literal('PACKAGE_SCANNED'),
    payload: z.object({
        location: z.string().min(1),
        scannerId: z.string().optional(),
    }),
});

export const StatusChanged = z.object({
    ...base,
    eventType: z.literal('STATUS_CHANGED'),
    payload: z.object({
        status: PackageStatus,
        location: z.string().optional(),
    }),
});

export const DeliveryMoved = z.object({
    ...base,
    eventType: z.literal('DELIVERY_MOVED'),
    payload: z.object({
        fromHub: z.string().min(1),
        toHub: z.string().min(1),
    }),
});

export const PackageEventSchema = z.discriminatedUnion('eventType', [
    PackageScanned,
    StatusChanged,
    DeliveryMoved,
]);

export type PackageEvent = z.infer<typeof PackageEventSchema>;