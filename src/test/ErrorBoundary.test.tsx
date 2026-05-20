import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';

// A component that throws during render
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Bomb exploded');
  }
  return <div>Safe content</div>;
}

describe('ErrorBoundary', () => {
  // Suppress expected console.error output from React's error boundary mechanism
  let consoleError: typeof console.error;
  beforeEach(() => {
    consoleError = console.error;
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = consoleError;
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('shows default fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Bomb exploded')).toBeDefined();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom error UI')).toBeDefined();
  });

  it('recovers when "Try again" is clicked', async () => {
    let shouldThrow = true;
    function ControlledBomb() {
      if (shouldThrow) throw new Error('Bomb exploded');
      return <div>Safe content</div>;
    }

    render(
      <ErrorBoundary>
        <ControlledBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();

    // Stop throwing before resetting the boundary so the retry succeeds
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try again'));

    await waitFor(() => {
      expect(screen.getByText('Safe content')).toBeDefined();
    });
  });
});
