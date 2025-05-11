// frontend/pages/_app.js

import React from 'react';
import '../styles/globals.css';
import { SessionProvider } from '../contexts/SessionContext';
import { ToastProvider } from '../contexts/ToastContext';
import Layout from '../components/Layout';

function MyApp({ Component, pageProps }) {
    // Check if layout should be hidden (for lab environment)
    const hideHeader = Component.hideHeader || false;

    // Get custom layout if provided
    const getLayout = Component.getLayout || ((page) => page);

    return (
        <ToastProvider>
            <SessionProvider>
                <Layout hideHeader={hideHeader}>
                    {getLayout(<Component {...pageProps} />)}
                </Layout>
            </SessionProvider>
        </ToastProvider>
    );
}

export default MyApp;