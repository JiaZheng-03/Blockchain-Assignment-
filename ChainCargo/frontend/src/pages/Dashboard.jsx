import AgreementCard from '../components/AgreementCard';
import { useWallet } from '../context/WalletContext';

function Dashboard() {
  const { account, isConnected, formatAddress, networkName, balance, isLoadingBalance } = useWallet();

  const agreements = isConnected
    ? [
        { title: 'Ocean Freight #101', amount: '10 ETH', status: 'Active', link: '/agreement/101' },
        { title: 'Cold Chain #204', amount: '6 ETH', status: 'Pending', link: '/agreement/204' },
      ]
    : [];

  const stats = [
    { title: 'Connected Wallet', value: account ? formatAddress(account) : 'Not connected' },
    { title: 'Network', value: networkName },
    { title: 'Balance', value: isLoadingBalance ? 'Loading...' : balance },
    { title: 'Status', value: isConnected ? 'Ready' : 'Disconnected' },
  ];

  return (
    <section>
      <div className="stat-grid">
        {stats.map((stat) => (
          <div className="stat-box" key={stat.title}>
            <h3>{stat.value}</h3>
            <p>{stat.title}</p>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Recent Agreements</h3>
        {isConnected ? (
          <div className="grid grid-2">
            {agreements.map((agreement) => (
              <AgreementCard key={agreement.title} {...agreement} />
            ))}
          </div>
        ) : (
          <p>Connect your wallet to see wallet-specific agreement data.</p>
        )}
      </div>
    </section>
  );
}

export default Dashboard;
