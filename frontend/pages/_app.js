// frontend/pages/_app.js - Next.js App component

import '../styles/globals.css';
import { SessionProvider } from '../contexts/SessionContext';
import Layout from '../components/Layout';

function MyApp({ Component, pageProps }) {
    // Check if layout should be hidden (for lab environment)
    const hideHeader = Component.hideHeader || false;

    // Get custom layout if provided
    const getLayout = Component.getLayout || ((page) => page);

    return (
        <SessionProvider>
            <Layout hideHeader={hideHeader}>
                {getLayout(<Component {...pageProps} />)}
            </Layout>
        </SessionProvider>
    );
}

export default MyApp;