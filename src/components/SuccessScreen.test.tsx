import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuccessScreen } from './SuccessScreen';

describe('SuccessScreen', () => {
  it('links to the REPLAY WhatsApp community in a new tab', () => {
    render(<SuccessScreen pending={false} editionName="REPLAY" />);

    const communityLink = screen.getByRole('link', { name: /join the replay whatsapp community/i });
    expect(communityLink).toHaveAttribute(
      'href',
      'https://chat.whatsapp.com/KMfBSQORNArFC88yvJs5ha?mode=gi_t',
    );
    expect(communityLink).toHaveAttribute('target', '_blank');
    expect(communityLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
