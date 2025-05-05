// frontend/pages/about.js - About page

import React from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import Link from 'next/link';

export default function About() {
    return (
        <Layout>
            <Head>
                <title>About | KillerKoda CKS Practice</title>
                <meta name="description" content="About the KillerKoda CKS Practice environment" />
            </Head>

            <div className="bg-white">
                <div className="max-w-7xl mx-auto py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
                    <div className="text-center">
                        <h1 className="mt-1 text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight lg:text-6xl">About KillerKoda CKS</h1>
                        <p className="max-w-xl mt-5 mx-auto text-xl text-gray-500">
                            Practice for the Certified Kubernetes Security Specialist exam with hands-on scenarios.
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 overflow-hidden">
                <div className="relative max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                    <div className="relative lg:grid lg:grid-cols-3 lg:gap-x-8">
                        <div className="lg:col-span-1">
                            <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                                What is KillerKoda CKS?
                            </h2>
                        </div>
                        <div className="mt-6 lg:mt-0 lg:col-span-2">
                            <p className="text-lg text-gray-500">
                                KillerKoda CKS is a self-hosted practice environment for the Certified Kubernetes Security Specialist (CKS) exam. It provides hands-on scenarios that simulate real-world security challenges in Kubernetes environments.
                            </p>
                            <p className="mt-4 text-lg text-gray-500">
                                Our platform creates isolated Kubernetes clusters using KubeVirt, allowing you to practice security techniques in a sandbox environment that closely resembles the actual CKS exam.
                            </p>
                        </div>
                    </div>

                    <div className="relative mt-12 sm:mt-16 lg:mt-24">
                        <div className="lg:grid lg:grid-flow-row-dense lg:grid-cols-3 lg:gap-8">
                            <div className="lg:col-span-2 lg:pl-8">
                                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                                    Key Features
                                </h2>
                                <ul className="mt-5 space-y-5">
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <p className="ml-3 text-base text-gray-700">
                                            <span className="font-medium text-gray-900">Real Kubernetes Environments</span> - Practice in actual Kubernetes clusters, not simulations
                                        </p>
                                    </li>
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <p className="ml-3 text-base text-gray-700">
                                            <span className="font-medium text-gray-900">Focused Security Scenarios</span> - Tasks that match CKS exam objectives and real-world challenges
                                        </p>
                                    </li>
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <p className="ml-3 text-base text-gray-700">
                                            <span className="font-medium text-gray-900">Automated Validation</span> - Get instant feedback on task completion
                                        </p>
                                    </li>
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <p className="ml-3 text-base text-gray-700">
                                            <span className="font-medium text-gray-900">Self-Hosted</span> - Run it on your own infrastructure with complete control
                                        </p>
                                    </li>
                                </ul>
                            </div>
                            <div className="mt-10 -mx-4 relative lg:mt-0 lg:col-span-1">
                                <div className="space-y-6">
                                    <div className="bg-white shadow overflow-hidden rounded-lg">
                                        <div className="px-4 py-5 sm:p-6">
                                            <h3 className="text-lg leading-6 font-medium text-gray-900">
                                                CKS Exam Topics
                                            </h3>
                                            <div className="mt-4 space-y-2">
                                                <p className="text-sm text-gray-500">• Cluster Setup</p>
                                                <p className="text-sm text-gray-500">• Cluster Hardening</p>
                                                <p className="text-sm text-gray-500">• System Hardening</p>
                                                <p className="text-sm text-gray-500">• Minimize Microservice Vulnerabilities</p>
                                                <p className="text-sm text-gray-500">• Supply Chain Security</p>
                                                <p className="text-sm text-gray-500">• Monitoring, Logging and Runtime Security</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="relative mt-12 sm:mt-16 lg:mt-24">
                        <div className="lg:grid lg:grid-cols-3 lg:gap-8">
                            <div className="lg:col-span-1">
                                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                                    Get Started
                                </h2>
                            </div>
                            <div className="mt-6 lg:mt-0 lg:col-span-2">
                                <p className="text-lg text-gray-500">
                                    Ready to prepare for the CKS exam? Browse our scenarios and start practicing in real Kubernetes environments.
                                </p>
                                <div className="mt-6">
                                    <Link href="/">
                                        <a className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                                            View Scenarios
                                        </a>
                                    </Link>

                                    href="https://github.com/fullstack-pw/cks"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center px-6 py-3 border border-gray-300 ml-4 shadow-sm text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                                    <svg className="-ml-1 mr-2 h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zM5.293 6.707a1 1 0 011.414-1.414L10 8.586l3.293-3.293a1 1 0 111.414 1.414L11.414 10l3.293 3.293a1 1 0 01-1.414 1.414L10 11.414l-3.293 3.293a1 1 0 01-1.414-1.414L8.586 10 5.293 6.707z" clipRule="evenodd" />
                                    </svg>
                                    GitHub Repository
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Layout >
  );
}