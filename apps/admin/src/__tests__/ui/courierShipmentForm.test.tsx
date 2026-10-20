import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, describe, vi, afterEach } from 'vitest';
import { CourierShipmentForm } from '@/app/[locale]/(dashboard)/orders/[id]/CourierShipmentForm';
import { toast } from 'sonner';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Mock the translations
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      placeholder: 'Select a courier',
      bosta: 'Bosta',
      aramex: 'Aramex',
      trackingNumber: 'Tracking number',
      save: 'Save',
      success: 'Success',
      error: 'Error',
    };
    return messages[key] || key;
  },
}));

// Mock the server action
const setShipmentActionMock = vi.fn();
vi.mock('../../app/[locale]/(dashboard)/orders/[id]/actions', () => ({
  setShipmentAction: (...args: any[]) => setShipmentActionMock(...args),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

describe('CourierShipmentForm', () => {
  it('renders correctly with initial values', () => {
    render(
      <CourierShipmentForm
        orderId="test-order-id"
        initialCourier="bosta"
        initialTrackingNumber="BST-12345"
      />
    );
    expect(screen.getByDisplayValue('BST-12345')).toBeDefined();
  });

  it('calls the server action on save and shows success toast', async () => {
    setShipmentActionMock.mockResolvedValueOnce({});

    render(
      <CourierShipmentForm
        orderId="test-order-id"
        initialCourier="aramex"
        initialTrackingNumber="ARX-98765"
      />
    );

    const saveButton = screen.getAllByText('Save')[0];
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(setShipmentActionMock).toHaveBeenCalledWith('test-order-id', 'aramex', 'ARX-98765');
      expect(toast.success).toHaveBeenCalledWith('Success');
    });
  });
});
