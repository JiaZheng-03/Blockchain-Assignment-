import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { AGREEMENT_STATUS } from '../contracts/abi';

export function normalizeAgreement(id, agreement) {
  return {
    id: Number(id),
    shipper: agreement.shipper,
    carrier: agreement.carrier,
    title: agreement.title,
    notes: agreement.notes,
    totalAmount: agreement.totalAmount,
    totalEth: ethers.formatEther(agreement.totalAmount),
    remainingAmount: agreement.remainingAmount,
    remainingEth: ethers.formatEther(agreement.remainingAmount),
    deadline: Number(agreement.deadline),
    createdAt: Number(agreement.createdAt),
    status: Number(agreement.status),
    statusLabel: AGREEMENT_STATUS[Number(agreement.status)],
    nextMilestone: Number(agreement.nextMilestone),
  };
}

export function useAgreements() {
  const { account, isConnected } = useWallet();
  const { getReadContract, isConfigured, refreshKey } = useContract();
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!account || !isConnected || !isConfigured) {
      setAgreements([]);
      return undefined;
    }

    async function loadAgreements() {
      setLoading(true);
      setError('');
      try {
        const contract = await getReadContract();
        const ids = await contract.getUserAgreementIds(account);
        const results = await Promise.all(
          ids.map(async (id) => normalizeAgreement(id, await contract.getAgreement(id))),
        );
        if (!cancelled) setAgreements(results.reverse());
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAgreements();
    return () => {
      cancelled = true;
    };
  }, [account, getReadContract, isConfigured, isConnected, refreshKey]);

  return { agreements, loading, error };
}
