import React from 'react';
import SourcesConfig from '../components/SourcesConfig';

export default function SourcesPage() {
  return (
    <div style={{ maxWidth: '900px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 16px' }}>Sources &amp; Connectors</h1>
      <SourcesConfig />
    </div>
  );
}
