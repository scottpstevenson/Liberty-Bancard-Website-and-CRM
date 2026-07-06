export interface PciRequirementDef {
  id: string;
  label: string;
  category: string;
}

export const PCI_REQUIREMENTS: PciRequirementDef[] = [
  { id: "ns1", label: "Firewall installed and configured to protect cardholder data", category: "Network Security" },
  { id: "ns2", label: "No vendor-supplied default passwords or security parameters in use", category: "Network Security" },
  { id: "ns3", label: "Network access to cardholder data environment is restricted", category: "Network Security" },
  { id: "dp1", label: "Cardholder data is not stored unless absolutely necessary", category: "Data Protection" },
  { id: "dp2", label: "Cardholder data is encrypted during transmission over public networks", category: "Data Protection" },
  { id: "dp3", label: "Systems and applications are kept up to date with security patches", category: "Data Protection" },
  { id: "ac1", label: "Each person with system access has a unique user ID", category: "Access Control" },
  { id: "ac2", label: "Physical access to cardholder data is restricted", category: "Access Control" },
  { id: "ac3", label: "All access to network resources and cardholder data is logged and monitored", category: "Access Control" },
  { id: "rt1", label: "Regular vulnerability scans are performed", category: "Regular Testing" },
  { id: "rt2", label: "Security systems and processes are tested regularly", category: "Regular Testing" },
  { id: "rt3", label: "An incident response plan is maintained and tested", category: "Regular Testing" },
];

export const PCI_REQUIREMENT_IDS: string[] = PCI_REQUIREMENTS.map((r) => r.id);

export const PCI_REQUIREMENT_ID_SET: Set<string> = new Set(PCI_REQUIREMENT_IDS);
