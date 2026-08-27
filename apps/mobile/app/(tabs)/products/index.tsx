export { ErrorBoundary } from "expo-router";
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TextInput, RefreshControl, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../../lib/api';

type Product = { id: string; name: string; price: number; stock: number };
const C = { ink: '#060A10', surface: '#0E1622', card: '#131E2E', border: '#1C2838', text: '#F0F6FF', muted: '#93A5BB', quiet: '#6D8198', gold: '#E0A23A', green: '#00C478', red: '#E83838' };

export default function ProductsScreen() {
  const { t } = useTranslation(); const [searchQuery, setSearchQuery] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['products'], queryFn: () => apiFetch<Product[]>('/api/products') });
  const filtered = useMemo(() => !data ? [] : !searchQuery ? data : data.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())), [data, searchQuery]);
  const lowStock = useMemo(() => filtered.filter(p => p.stock <= 5).length, [filtered]);
  const onRefresh = React.useCallback(() => { setRefreshing(true); refetch().finally(() => setRefreshing(false)); }, [refetch]);

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={C.gold} /><Text style={styles.centerText}>{t('common.loading')}</Text></View>;
  if (error) return <View style={styles.center}><Ionicons name="alert-circle-outline" size={28} color={C.red} /><Text style={styles.centerText}>{t('common.error')}</Text></View>;

  return <View style={styles.container}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>INVENTORY</Text><Text style={styles.title}>المنتجات</Text></View><View style={styles.count}><Text style={styles.countNumber}>{filtered.length}</Text><Text style={styles.countLabel}>منتج</Text></View></View>
    <View style={styles.search}><Ionicons name="search-outline" size={18} color={C.quiet} /><TextInput style={styles.input} placeholder={t('products.searchPlaceholder')} placeholderTextColor={C.quiet} value={searchQuery} onChangeText={setSearchQuery} textAlign="right" /></View>
    {lowStock > 0 && <View style={styles.alert}><Ionicons name="warning-outline" size={18} color={C.gold} /><Text style={styles.alertText}>{lowStock} منتج يحتاج مراجعة المخزون</Text></View>}
    <FlatList data={filtered} keyExtractor={item => item.id} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable style={styles.row}><View style={[styles.stockDot, item.stock <= 5 && styles.stockLow]} /><View style={styles.body}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.price.toLocaleString('ar-EG')} ج.م</Text></View><View style={styles.stock}><Text style={[styles.stockValue, item.stock <= 5 && styles.lowText]}>{item.stock}</Text><Text style={styles.stockLabel}>المخزون</Text></View><Ionicons name="chevron-back" size={16} color={C.quiet} /></Pressable>} ListEmptyComponent={<View style={styles.empty}><Ionicons name="cube-outline" size={30} color={C.quiet} /><Text style={styles.emptyTitle}>{t('products.empty')}</Text><Text style={styles.emptyCaption}>جرّب تغيير كلمة البحث.</Text></View>} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.gold} />} />
  </View>;
}

const styles = StyleSheet.create({ container:{flex:1,backgroundColor:C.ink,paddingHorizontal:20,paddingTop:16},header:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',marginBottom:16},eyebrow:{color:C.quiet,fontSize:9,fontWeight:'700',letterSpacing:1.5},title:{color:C.text,fontSize:26,fontWeight:'800',marginTop:3},count:{alignItems:'flex-end'},countNumber:{color:C.gold,fontSize:20,fontWeight:'800'},countLabel:{color:C.quiet,fontSize:9},search:{height:48,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,flexDirection:'row',alignItems:'center',paddingHorizontal:13,marginBottom:12},input:{flex:1,color:C.text,fontSize:13,marginHorizontal:9,height:46},alert:{minHeight:42,borderWidth:1,borderColor:'rgba(224,162,58,.25)',backgroundColor:'rgba(224,162,58,.07)',flexDirection:'row-reverse',alignItems:'center',paddingHorizontal:12,marginBottom:8,gap:8},alertText:{color:C.muted,fontSize:11},list:{paddingBottom:32},row:{minHeight:72,borderBottomWidth:1,borderBottomColor:C.border,flexDirection:'row',alignItems:'center',paddingVertical:10},stockDot:{width:7,height:7,borderRadius:4,backgroundColor:C.green,marginRight:12},stockLow:{backgroundColor:C.gold},body:{flex:1},name:{color:C.text,fontSize:13,fontWeight:'700'},meta:{color:C.quiet,fontSize:10,marginTop:4},stock:{width:48,alignItems:'flex-end',marginRight:8},stockValue:{color:C.text,fontSize:14,fontWeight:'800'},lowText:{color:C.gold},stockLabel:{color:C.quiet,fontSize:8,marginTop:2},empty:{alignItems:'center',paddingTop:60},emptyTitle:{color:C.text,fontSize:13,fontWeight:'700',marginTop:10},emptyCaption:{color:C.quiet,fontSize:11,marginTop:5},center:{flex:1,backgroundColor:C.ink,alignItems:'center',justifyContent:'center',gap:10},centerText:{color:C.muted,fontSize:12}});
