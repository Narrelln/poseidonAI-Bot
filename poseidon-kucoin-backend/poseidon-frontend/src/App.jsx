import OpenPositionsPanel from './components/OpenPositionsPanel.jsx';

function App() {
  return (
    <div className="app">
      <h1>📂 Poseidon Open Positions</h1>
      <OpenPositionsPanel />
      <div id="modal-root"></div>
    </div>
  );
}

export default App;