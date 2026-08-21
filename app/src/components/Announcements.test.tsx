import { render, screen } from '@testing-library/react';
import { Announcements } from './Announcements';

it('shows active notices with severity and audience context', () => {
  render(<Announcements timezone="Asia/Kolkata" announcements={[
    {
      id: 'incident-1',
      title: 'Use the east exit',
      body: 'The west corridor is temporarily closed.',
      severity: 'incident',
      audience: 'all',
      starts_at: '2026-09-12T05:00:00.000Z',
      ends_at: null,
      updated_at: '2026-09-12T05:00:00.000Z',
    },
    {
      id: 'info-1',
      title: 'Library is open',
      body: 'Borrow games at the help desk.',
      severity: 'info',
      audience: 'day1',
      starts_at: '2026-09-12T04:30:00.000Z',
      ends_at: '2026-09-12T12:30:00.000Z',
      updated_at: '2026-09-12T04:30:00.000Z',
    },
  ]} />);

  expect(screen.getByRole('alert')).toHaveTextContent('Safety notice');
  expect(screen.getByRole('alert')).toHaveTextContent('Use the east exit');
  expect(screen.getByText('Day 1 attendees')).toBeInTheDocument();
  expect(screen.getByText(/Until/)).toBeInTheDocument();
});

it('renders nothing when there are no notices', () => {
  const { container } = render(<Announcements timezone="Asia/Kolkata" announcements={[]} />);
  expect(container).toBeEmptyDOMElement();
});
