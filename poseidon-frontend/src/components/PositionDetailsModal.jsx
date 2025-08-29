import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom'; // 🔥 Required for portal
import './PositionDetailsModal.css';


export default function PositionDetailsModal({ symbol, contract, onClose }) {
  const [details, setDetails] = useState(null);

  useEffect(() => {
    let intervalId = null;

    const fetchDetails = () => {
      fetch(`/api/position-details/${contract}`)
        .then(res => res.json())
        .then(data => setDetails(data))
        .catch(err => console.error('❌ Modal fetch error:', err.message));
    };

    fetchDetails(); // Initial fetch
    intervalId = setInterval(fetchDetails, 5000); // Refresh every 5 seconds

    return () => clearInterval(intervalId); // Cleanup on modal close
  }, [contract]);

  const content = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{symbol} — Detailed View</div>

        {!details ? (
          <p>Loading...</p>
        ) : (
          <div className="modal-grid">
            <div className="modal-label">Entry</div>
            <div>{details.entryPrice ?? '--'}</div>

            <div className="modal-label">Mark</div>
            <div>{details.markPrice ?? '--'}</div>

            <div className="modal-label">Leverage</div>
            <div>{details.leverage ?? '--'}</div>

            <div className="modal-label">Size</div>
            <div>{details.size ?? '--'}</div>

            <div className="modal-label">Volume</div>
            <div>{details.volume ?? '--'}</div>

            <div className="modal-label">Confidence</div>
            <div>{details.confidence !== undefined ? `${details.confidence}%` : '--'}</div>

            <div className="modal-label">Win Rate</div>
            <div>{details.winRate !== undefined ? `${details.winRate}%` : '--'}</div>

            <div className="modal-label">PNL</div>
            <div style={{ color: details.pnlValue > 0 ? 'lime' : details.pnlValue < 0 ? 'red' : 'gray' }}>
              {details.pnlValue ?? '--'}
            </div>

            <div className="modal-label">ROI</div>
            <div style={{ color: details.roi > 0 ? 'lime' : details.roi < 0 ? 'red' : 'gray' }}>
              {details.roi ?? '--'}%
            </div>
          </div>
        )}
        <button className="modal-close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.getElementById('modal-root'));
}