
import { useState, useEffect, useRef } from 'react';
import { 
  Users, Building2, DollarSign, Calendar, 
  Search, Plus, Smartphone, X, Loader2,
  ChevronDown, Eye, Settings, AlertCircle,
  CheckCircle, Banknote
} from 'lucide-react';
import { assetsService, type Asset, type Property } from '../../services/Assets';
import { useAuth } from '../../context/authContext';
import AddPropertyModal from './AddProp';
import AddTenantModal from './AddTenant';
import AddInvoiceModal from './AddInvc';
import ViewPropertyModal from './PropList';
import AddAssetModal from './AddAsset';
import { Paystack } from '../../services/paystackService';
import SettlementFields, { type SettlementType } from '../SettlementFields';

// StatCard Component
const StatCard = ({ icon, value, trend, color, label }: { 
  icon: any; 
  value: any; 
  trend: any; 
  color: any; 
  label: string 
}) => {
  const colorClasses: Record<string, string> = {
    cyan: 'from-cyan-500 to-cyan-600',
    emerald: 'from-emerald-500 to-emerald-600',
    violet: 'from-violet-500 to-violet-600',
    amber: 'from-amber-500 to-amber-600'
  };

  return (
    <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-5 hover:border-cyan-500/50 transition-all duration-300">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 bg-gradient-to-br ${colorClasses[color]} rounded-lg text-white shadow-lg`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/30">
          {trend}
        </span>
      </div>
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
};

type PaymentMode = 'mobile_money' | 'bank' | 'till';

// Payment Settings Modal Component
const PaymentSettingsModal = ({
  isOpen,
  onClose,
  asset
}: {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset;
}) => {
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentMode>('mobile_money');
  const settlementBank: SettlementType = selectedPaymentMode === 'bank' ? 'bank' : selectedPaymentMode === 'till' ? 'till' : 'mpesa';
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false);




  const [businessName, setBusinessName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const paymentModes = [
    {
      id: 'mobile_money' as PaymentMode,
      name: 'M-Pesa',
      description: 'M-Pesa (Safaricom)',
      icon: Smartphone,
      color: 'bg-green-500',
      available: true
    },
    {
      id: 'bank' as PaymentMode,
      name: 'Bank Account',
      description: 'Direct bank transfer',
      icon: Building2,
      color: 'bg-blue-500',
      available: true
    },
    {
      id: 'till' as PaymentMode,
      name: 'Buy Goods (Till)',
      description: 'M-Pesa Till Number',
      icon: Banknote,
      color: 'bg-orange-500',
      available: true
    }
  ];

  const handleSavePaymentInfo = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSavingPaymentInfo(true);
      
      await Paystack.setupPaymentAccount({
        businessName,
        settlementBank,
        bankCode: settlementBank === 'bank' ? bankCode : undefined,
        accountNumber,
        email,
        name,
        phone,
        userId: asset.id,
        pId: null
      });
      
      onClose();
      alert('Payment account setup successfully!');
      
    } catch (err: any) {
      alert(err.message || 'Failed to setup payment account');
    } finally {
      setSavingPaymentInfo(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Payment Account Settings</h2>
            <p className="text-sm text-gray-600 mt-1">{asset.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {asset?.paymentInfo?.accountId ? (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start space-x-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-green-900 font-semibold">Payment Account Active</p>
                <p className="text-green-700 text-sm mt-1">
                  Subaccount Code: {asset?.paymentInfo.accountId}
                </p>
                <p className="text-green-700 text-sm">
                  Commission Rate: {asset?.paymentInfo.split}%
                </p>
                <p className="text-green-700 text-sm">
                  Settlement Bank: {asset?.paymentInfo.settlementBank.toUpperCase()}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm">
              No payment account configured. Setup account details to receive payments via split settlement.
            </p>
          </div>
        )}

        <div className="mb-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Select Payment Method</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {paymentModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setSelectedPaymentMode(mode.id)}
                disabled={!mode.available}
                className={`relative p-4 rounded-xl border-2 transition-all ${
                  selectedPaymentMode === mode.id
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                } ${!mode.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`${mode.color} p-2 rounded-lg`}>
                    <mode.icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-gray-900 text-sm sm:text-base">{mode.name}</p>
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">{mode.description}</p>
                  </div>
                  {selectedPaymentMode === mode.id && (
                    <CheckCircle className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Automatic setup: M-Pesa (Safaricom), Till or Bank */}
          <form onSubmit={handleSavePaymentInfo} className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-900 font-semibold text-sm">Automated Setup Available</p>
                  <p className="text-blue-700 text-xs mt-1">
                    Your payout account is set up instantly. No WhatsApp or waiting needed.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Business Name
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder={asset.name}
              />
            </div>

            <SettlementFields
              settlementBank={settlementBank}
              hideTypeSelect
              bankCode={bankCode}
              setBankCode={setBankCode}
              accountNumber={accountNumber}
              setAccountNumber={setAccountNumber}
              loadBanks={Paystack.listKenyaBanks}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contact Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder={asset.email}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contact Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder={asset.name}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contact Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder={asset.phone}
              />
            </div>

            <button
              type="submit"
              disabled={savingPaymentInfo}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingPaymentInfo ? (
                <span className="flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Setting up account...
                </span>
              ) : (
                asset?.paymentInfo?.accountId ? 'Update Payment Account' : 'Setup Payment Account'
              )}
            </button>
          </form>

      </div>
    </div>
  );
};

// Asset Options Dropdown
const AssetOptionsDropdown = ({ 
  onAddProperty,
  onManageTenants,
  onManageInvoices,
  onViewProperties,
  onClose
}: {
  asset: Asset;
  onAddProperty: () => void;
  onManageTenants: () => void;
  onManageInvoices: () => void;
  onViewProperties: () => void;
  onClose: () => void;
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={dropdownRef} className="absolute right-0 top-full mt-2 w-56 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-50">
      <div className="p-2 space-y-1">
        <button
          onClick={() => { onViewProperties(); onClose(); }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <Eye className="w-4 h-4 text-cyan-400" />
          <span>View Properties</span>
        </button>
        <button
          onClick={() => { onAddProperty(); onClose(); }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 text-cyan-400" />
          <span>Add Property</span>
        </button>
        <button
          onClick={() => { onManageTenants(); onClose(); }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 text-emerald-400" />
          <span>Add Tenant</span>
        </button>
        <button
          onClick={() => { onManageInvoices(); onClose(); }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 text-violet-400" />
          <span>Add Invoice</span>
        </button>
      </div>
    </div>
  );
};

// Properties List Modal
const PropertiesListModal = ({
  isOpen,
  onClose,
  asset,
  onSelectProperty
}: {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset;
  onSelectProperty: (property: Property) => void;
}) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadProperties();
    }
  }, [isOpen]);

  const loadProperties = async () => {
    setLoading(true);
    try {
      const props = await assetsService.getPropertiesByAsset(asset.id);
      setProperties(props);
    } catch (error) {
      console.error('Error loading properties:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-gray-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white">Properties for {asset.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No properties found</p>
            <p className="text-sm text-gray-500 mt-1">Add a property to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {properties.map((property) => (
              <button
                key={property.id}
                onClick={() => {
                  onSelectProperty(property);
                  onClose();
                }}
                className="w-full p-4 bg-gray-700/30 hover:bg-gray-700/50 rounded-lg border border-gray-700 hover:border-cyan-500/50 transition-all text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-white">{property.name}</h4>
                    <p className="text-sm text-gray-400">{property.address || 'No address'}</p>
                    {property.billingMode === 'rent_only' && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">Rent only</span>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400">Max Units</p>
                    <p className="font-medium text-white">{property.maxUnits}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};



// Main PlotTab Component
const PlotTab = ({ onOpenTerminal }: { onOpenTerminal: (asset: any) => void }) => {
  const { firestoreUser } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState({
    totalAssets: 0,
    totalTenants: 0,
    monthlyRevenue: 0,
    pendingRenewals: 0
  });
  const [monthlyTrends, setMonthlyTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalType, setAddModalType] = useState<'landlord' | 'agent'>('landlord');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showOptionsFor, setShowOptionsFor] = useState<string | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPropertiesList, setShowPropertiesList] = useState(false);
  const [showViewProperty, setShowViewProperty] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [showPaymentSettingsModal, setShowPaymentSettingsModal] = useState(false);

  useEffect(() => {
    loadData();
  }, [firestoreUser]);

  const loadData = async () => {
    if (!firestoreUser?.pId) return;
    
    setLoading(true);
    try {
      const [assetsData, statsData, trendsData] = await Promise.all([
        assetsService.getAssetsByCyberId(firestoreUser.pId),
        assetsService.getDashboardStats(firestoreUser.pId),
        assetsService.getMonthlyTrends(firestoreUser.pId, 6)
      ]);

      setAssets(assetsData);
      setStats(statsData);
      setMonthlyTrends(trendsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         asset.phone.includes(searchTerm);
    const matchesFilter = filterType === 'all' || asset.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const handleAddAsset = (type: 'landlord' | 'agent') => {
    setAddModalType(type);
    setShowAddModal(true);
  };

  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowOptionsFor(asset.id);
  };

  const handleViewProperties = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowPropertiesList(true);
  };

  const openSettings = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowPaymentSettingsModal(true);
  };

  const handleSelectProperty = (property: Property) => {
    setSelectedProperty(property);
    setShowViewProperty(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Total Assets"
          value={stats.totalAssets}
          trend="+12%"
          color="cyan"
        />
        <StatCard
          icon={<Building2 className="w-5 h-5" />}
          label="Total Tenants"
          value={stats.totalTenants}
          trend="+8%"
          color="emerald"
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Monthly Revenue"
          value={`KES ${stats.monthlyRevenue.toLocaleString()}`}
          trend="+23%"
          color="violet"
        />
        <StatCard
          icon={<Calendar className="w-5 h-5" />}
          label="Pending Renewals"
          value={stats.pendingRenewals}
          trend={`${stats.pendingRenewals} due`}
          color="amber"
        />
      </div>

      {/* Assets Management */}
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h3 className="text-lg font-semibold text-white">Managed Assets</h3>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-64 pl-10 pr-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm text-white placeholder-gray-500"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg focus:ring-2 focus:ring-cyan-500 text-sm text-white"
            >
              <option value="all">All Types</option>
              <option value="landlord">Landlords</option>
              <option value="agent">Agents</option>
            </select>
          </div>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No assets found</p>
            <p className="text-sm text-gray-500 mt-1">
              {searchTerm || filterType !== 'all' 
                ? 'Try adjusting your search or filters' 
                : 'Start by adding a landlord or agent'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto relative">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Contact</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Properties</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Tenants</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset) => (
                  <tr key={asset.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="py-4 px-4">
                      <button
                        onClick={() => handleAssetClick(asset)}
                        className="text-left hover:text-cyan-400 transition-colors"
                      >
                        <div className="font-medium text-white">{asset.name}</div>
                        {asset.company && (
                          <div className="text-xs text-gray-500 mt-1">{asset.company.name}</div>
                        )}
                      </button>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                        asset.type === 'agent' 
                          ? 'bg-violet-500/10 text-violet-400 border border-violet-500/30' 
                          : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      }`}>
                        {asset.type === 'agent' ? 'Agent' : 'Landlord'}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-400">{asset.phone}</div>
                      <div className="text-xs text-gray-500">{asset.email}</div>
                    </td>
                    <td className="py-4 px-4 text-center text-sm text-white">{asset.properties}</td>
                    <td className="py-4 px-4 text-center text-sm text-white">{asset.tenants}</td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => onOpenTerminal(asset)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500 text-black rounded-lg hover:bg-cyan-400 transition-colors text-sm font-medium shadow-lg shadow-cyan-500/20"
                        >
                          <Smartphone className="w-4 h-4" />
                          Terminal
                        </button>
                        <button
                          onClick={() => openSettings(asset)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500 text-black rounded-lg hover:bg-cyan-400 transition-colors text-sm font-medium shadow-lg shadow-cyan-500/20"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => handleAssetClick(asset)}
                            className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded-lg transition-colors"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          {showOptionsFor === asset.id && (
                            <div className="absolute top-full right-0 z-50 mt-1">
                              <AssetOptionsDropdown
                                asset={asset}
                                onAddProperty={() => {
                                  setSelectedAsset(asset);
                                  setShowPropertyModal(true);
                                }}
                                onManageTenants={() => {
                                  setSelectedAsset(asset);
                                  setShowTenantModal(true);
                                }}
                                onManageInvoices={() => {
                                  setSelectedAsset(asset);
                                  setShowInvoiceModal(true);
                                }}
                                onViewProperties={() => handleViewProperties(asset)}
                                onClose={() => setShowOptionsFor(null)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* {filteredAssets.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No assets found</p>
            <p className="text-sm text-gray-500 mt-1">
              {searchTerm || filterType !== 'all' 
                ? 'Try adjusting your search or filters' 
                : 'Start by adding a landlord or agent'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Contact</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Properties</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Tenants</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset) => (
                  <tr key={asset.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="py-4 px-4">
                      <button
                        onClick={() => handleAssetClick(asset)}
                        className="text-left hover:text-cyan-400 transition-colors"
                      >
                        <div className="font-medium text-white">{asset.name}</div>
                        {asset.company && (
                          <div className="text-xs text-gray-500 mt-1">{asset.company.name}</div>
                        )}
                      </button>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                        asset.type === 'agent' 
                          ? 'bg-violet-500/10 text-violet-400 border border-violet-500/30' 
                          : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      }`}>
                        {asset.type === 'agent' ? 'Agent' : 'Landlord'}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-400">{asset.phone}</div>
                      <div className="text-xs text-gray-500">{asset.email}</div>
                    </td>
                    <td className="py-4 px-4 text-center text-sm text-white">{asset.properties}</td>
                    <td className="py-4 px-4 text-center text-sm text-white">{asset.tenants}</td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-center gap-2 relative">
                        <button
                          onClick={() => onOpenTerminal(asset)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500 text-black rounded-lg hover:bg-cyan-400 transition-colors text-sm font-medium shadow-lg shadow-cyan-500/20"
                        >
                          <Smartphone className="w-4 h-4" />
                          Terminal
                        </button>
                        <button
                          onClick={() => openSettings(asset)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500 text-black rounded-lg hover:bg-cyan-400 transition-colors text-sm font-medium shadow-lg shadow-cyan-500/20"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleAssetClick(asset)}
                          className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {showOptionsFor === asset.id && (
                          <AssetOptionsDropdown
                            asset={asset}
                            onAddProperty={() => {
                              setSelectedAsset(asset);
                              setShowPropertyModal(true);
                            }}
                            onManageTenants={() => {
                              setSelectedAsset(asset);
                              setShowTenantModal(true);
                            }}
                            onManageInvoices={() => {
                              setSelectedAsset(asset);
                              setShowInvoiceModal(true);
                            }}
                            onViewProperties={() => handleViewProperties(asset)}
                            onClose={() => setShowOptionsFor(null)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )} */}
      </div>

      {/* Monthly Trends Chart */}
      {monthlyTrends.length > 0 && (
        <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
          <h3 className="text-lg font-semibold mb-4 text-white">Monthly Trends</h3>
          <div className="h-64 flex items-end justify-between gap-2">
            {monthlyTrends.map((data, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full bg-gradient-to-t from-cyan-500 to-cyan-400 rounded-t-lg transition-all hover:from-cyan-600 hover:to-cyan-500 shadow-lg shadow-cyan-500/20"
                     style={{ height: `${(data.income / 200000) * 100}%` }}>
                </div>
                <span className="text-xs text-gray-400 font-medium">{data.month}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-cyan-500 rounded shadow-sm shadow-cyan-500/50"></div>
              <span className="text-gray-400">Income (KES)</span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
        <button 
          onClick={() => handleAddAsset('landlord')}
          className="flex items-center justify-center gap-2 px-6 py-4 bg-cyan-500 text-black rounded-xl hover:bg-cyan-400 transition-all shadow-lg shadow-cyan-500/30 font-semibold"
        >
          <Plus className="w-5 h-5" />
          <span>Add Landlord</span>
        </button>
        <button 
          onClick={() => handleAddAsset('agent')}
          className="flex items-center justify-center gap-2 px-6 py-4 bg-transparent border-2 border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all rounded-xl font-semibold"
        >
          <Plus className="w-5 h-5" />
          <span>Add Agent</span>
        </button>
      </div>

      {/* Modals */}
      <AddAssetModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        type={addModalType}
        onSuccess={loadData}
      />

      {selectedAsset && (
        <>
          <AddPropertyModal
            isOpen={showPropertyModal}
            onClose={() => {
              setShowPropertyModal(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
            onSuccess={loadData}
            pId={firestoreUser.pId}
          />

          <AddTenantModal
            isOpen={showTenantModal}
            onClose={() => {
              setShowTenantModal(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
            onSuccess={loadData}
          />

          <AddInvoiceModal
            isOpen={showInvoiceModal}
            onClose={() => {
              setShowInvoiceModal(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
            onSuccess={loadData}
          />

          <PaymentSettingsModal
            isOpen={showPaymentSettingsModal}
            onClose={() => {
              setShowPaymentSettingsModal(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
          />

          <PropertiesListModal
            isOpen={showPropertiesList}
            onClose={() => {
              setShowPropertiesList(false);
              setSelectedAsset(null);
            }}
            asset={selectedAsset}
            onSelectProperty={handleSelectProperty}
          />
        </>
      )}

      {selectedAsset && selectedProperty && (
        <ViewPropertyModal
          isOpen={showViewProperty}
          onClose={() => {
            setShowViewProperty(false);
            setSelectedProperty(null);
          }}
          asset={selectedAsset}
          property={selectedProperty}
          onSuccess={loadData}
        />
      )}
    </div>
  );
};

export default PlotTab;