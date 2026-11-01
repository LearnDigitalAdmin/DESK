import { doc, getDoc } from "firebase/firestore";
import { db, functionsAfrica as functions } from "./firebaseService";
import { httpsCallable } from "firebase/functions";



export class Paystack{




    static async getAgent(userId: string): Promise<any | null> {
    try {
          const userDocRef = doc(db, 'agents', userId);
          
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
            const data = userDoc.data();
             return {
                id: userId,
                phone: data.phone || '',
                email: data.email || '',
                name: data.name || '',
                //role: 'agent',
                //tier: data.tier,
                paymentInfo: data.paymentInfo
            };
          } else {
            console.warn('⚠️ [fetchFirestoreUser] User document does not exist in Firestore');
          }
        } catch (error) {
          
        }
  }


  static async listKenyaBanks(): Promise<{ name: string; code: string }[]> {
    const res = await httpsCallable<unknown, { banks: { name: string; code: string }[] }>(functions, 'listKenyaBanks')({});
    return res.data.banks;
  }

  static async setupPaymentAccount(data: {
    businessName: string;
    settlementBank: 'mpesa' | 'till' | 'bank';
    bankCode?: string;
    accountNumber: string;
    email: string;
    name: string;
    phone: string;
    userId: string;
    pId: string | null;
  }): Promise<void> {
    try {
      const setupAccount = httpsCallable(functions, 'setupAccount');
      const result = await setupAccount(data);
      
      console.log('Payment account setup result:', result.data);
    } catch (error: any) {
      console.error('Error setting up payment account:', error);
      throw new Error(error.message || 'Failed to setup payment account');
    }
  }
}
