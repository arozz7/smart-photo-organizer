import React, { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { PeopleProvider } from '../../../src/context/PeopleContext';
import { AIProvider } from '../../../src/context/AIContext';
import { ScanProvider } from '../../../src/context/ScanContext';
import { AlertProvider } from '../../../src/context/AlertContext';
import { ToastProvider } from '../../../src/context/ToastContext';

/**
 * A wrapper component that provides all application contexts for testing.
 */
export function TestProviders({ children }: { children: ReactNode }) {
    return (
        <MemoryRouter>
            <ToastProvider>
                <AlertProvider>
                    <AIProvider>
                        <PeopleProvider>
                            <ScanProvider>
                                {children}
                            </ScanProvider>
                        </PeopleProvider>
                    </AIProvider>
                </AlertProvider>
            </ToastProvider>
        </MemoryRouter>
    );
}

/**
 * Creates a custom wrapper for specific context combinations if needed.
 */
export function createWrapper(providers: React.ComponentType<{ children: ReactNode }>[]) {
    return ({ children }: { children: ReactNode }) => {
        return providers.reduceRight(
            (acc, Provider) => <Provider>{acc}</Provider>,
            children
        );
    };
}
