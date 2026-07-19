import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import AgreementCard from '../components/AgreementCard';
import { useWallet } from '../context/WalletContext';

function Dashboard() {
  const { account, isConnected, formatAddress, networkName } = useWallet();
  const [balance, setBalance] = useState('0 ETH');
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !account || typeof window === 'undefined' || !window.ethereum) {
      setBalance('0 ETH');
      setBalanceLoading(false);
      return undefined;
    }

    let isCancelled = false;

    const fetchBalance = async () => {
      try {
        setBalanceLoading(true);
        const provider = new ethers.BrowserProvider(window.ethereum);
        const balance = await provider.getBalance(account);
        const formattedBalance = ethers.formatEther(balance);

        if (!isCancelled) {
          setBalance(`${Number(formattedBalance).toFixed(4)} ETH`);
        }
      } catch (error) {
        console.error(error);
        if (!isCancelled) {
          setBalance('Unavailable');
        }
      } finally {
        if (!isCancelled) {
          setBalanceLoading(false);
        }
      }
    };

    fetchBalance();

    return () => {
      isCancelled = true;
    };
  }, [account, isConnected]);

  const agreements = isConnected
    ? [
        { title: 'Ocean Freight #101', amount: '10 ETH', status: 'Active', link: '/agreement/101' },
        { title: 'Cold Chain #204', amount: '6 ETH', status: 'Pending', link: '/agreement/204' },
      ]
    : [];

  const stats = [
    { title: 'Connected Wallet', value: account ? formatAddress(account) : 'Not connected' },
    { title: 'Network', value: networkName },
    { title: 'Balance', value: balanceLoading ? 'Loading...' : balance },
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
