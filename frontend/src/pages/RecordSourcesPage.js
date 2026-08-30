import React from 'react';
import SourcesConfig from '../components/SourcesConfig';
import SetupScreen from '../components/setup/SetupScreen';

// RECORD SOURCES AND CONNECTORS — the hub's `sources` row (C14, Kevin 2026-08-30: the admin "Sources" tab
// becomes this dedicated screen; the row is renamed from "Where the records live"). The connector /
// discovery surface itself is the existing SourcesConfig component, unchanged.

export default function RecordSourcesPage() {
  return (
    <SetupScreen hubKey="sources" laneLabel="Technical Setup" title="Record Sources and Connectors"
      intro="The systems this city's records live in, and the connectors that reach them. Connect a source, then run discovery to catalog the record types it holds.">
      {function () { return <SourcesConfig />; }}
    </SetupScreen>
  );
}
