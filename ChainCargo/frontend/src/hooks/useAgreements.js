import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { AGREEMENT_STATUS } from '../contracts/abi';
import { buildAgreementIds, isArbitrationAgreement } from '../utils/arbitration';

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

export function useAgreements({ arbitration = false } = {}) {
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
        const ids = arbitration
          ? buildAgreementIds(await contract.agreementCount())
          : await contract.getUserAgreementIds(account);
        let results = await Promise.all(
          ids.map(async (id) => {
            const [rawAgreement, acceptanceDeadline, milestoneDisputes] = await Promise.all([
              contract.getAgreement(id),
              contract.carrierAcceptanceDeadline(id),
              arbitration
                ? Promise.all([0, 1].map((milestoneIndex) => (
                    contract.getMilestoneDispute(id, milestoneIndex).catch(() => null)
                  )))
                : [],
            ]);
            const agreement = {
              ...normalizeAgreement(id, rawAgreement),
              carrierAcceptanceDeadline: Number(acceptanceDeadline),
              hasArbitrationHistory: milestoneDisputes.some(
                (dispute) => dispute && Number(dispute.openedAt) > 0,
              ),
            };
            if (agreement.status !== 0) return agreement;

            const milestones = await contract.getMilestones(id);
            const currentMilestone = milestones[agreement.nextMilestone];
            return {
              ...agreement,
              currentMilestoneDueAt: currentMilestone ? Number(currentMilestone.dueAt) : null,
              currentMilestoneName: currentMilestone?.name || '',
              currentMilestoneState: currentMilestone ? Number(currentMilestone.state) : null,
              currentMilestoneSubmittedAt: currentMilestone
                ? Number(currentMilestone.submittedAt)
                : null,
            };
          }),
        );
        if (arbitration) results = results.filter(isArbitrationAgreement);
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
  }, [account, arbitration, getReadContract, isConfigured, isConnected, refreshKey]);

  return { agreements, loading, error };
}
