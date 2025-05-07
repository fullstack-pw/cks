// frontend/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: 'http://localhost:8080/api/:path*'
            }
        ]
    },
    // Add WebSocket proxy configuration
    async headers() {
        return [
            {
                // This applies to all routes
                source: '/:path*',
                headers: [
                    { key: 'Upgrade', value: 'websocket' },
                    { key: 'Connection', value: 'Upgrade' }
                ]
            }
        ];
    }
}

module.exports = nextConfig