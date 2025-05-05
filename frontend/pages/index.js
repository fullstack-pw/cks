// frontend/pages/index.js - Home page with scenario list

import React from 'react';
import Head from 'next/head';
import ScenarioList from '../components/ScenarioList';

export default function Home() {
    return (
        <div>
            <Head>
                <title>KillerKoda CKS Practice</title>
                <meta name="description" content="Practice for CKS certification with interactive scenarios" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <div className="bg-gray-50 min-h-screen">
                <header className="bg-white shadow">
                    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                        <h1 className="text-3xl font-bold text-gray-900">CKS Practice Labs</h1>
                    </div>
                </header>
                <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    <ScenarioList />
                </main>
            </div>
        </div>
    );
}