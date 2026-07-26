import { useWallet } from '../context/WalletContext';

function History() {
  const { isConnected, formatAddress, account } = useWallet();

  const events = [
    { title: 'Agreement Created', detail: 'Ocean Freight #101 was created on-chain' },
    { title: 'Deposit Received', detail: '10 ETH escrowed successfully' },
    { title: 'Milestone Approved', detail: 'Pickup milestone released' },
  ];

  if (!isConnected) {
    return (
      <div className="panel">
        <h3>Transaction History</h3>
        <p>Connect your wallet to view transaction history for account {formatAddress(account)}.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Transaction History for {formatAddress(account)}</h3>
      <div className="list">
        {events.map((event) => (
          <div className="list-item" key={event.title}>
            <div>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default History;
